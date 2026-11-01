//! Word expansion: tilde, variable, command substitution, brace, and glob.
//!
//! If a word contains command substitution or glob expansion syntax then it
//! needs to be evaluated at runtime — this state node walks the atom and
//! produces zero or more output strings.

use crate::shell::ast;
use crate::shell::interpreter::{
    EventLoopHandle, Interpreter, Node, NodeId, ShellExecEnv, ShellExecEnvKind, StateKind, log,
};
use crate::shell::io::{IO, OutKind};
use crate::shell::states::assigns::AssignCtx;
use crate::shell::states::base::Base;
use crate::shell::states::script::Script;
use crate::shell::yield_::Yield;
use crate::shell::{EnvStr, ExitCode, ShellErr};

pub(crate) struct Expansion {
    pub(crate) base: Base,
    pub node: bun_ptr::BackRef<ast::Atom>,
    pub(crate) state: ExpansionState,
    /// Index of the next sub-atom to expand. For `Atom::Simple` this is 0/1;
    /// for `Atom::Compound` it walks `c.atoms`.
    /// After `finish_fields`: the entry of `meta_offsets` where the next field for `out` starts.
    pub(crate) word_idx: u32,
    /// Output sink the parent provided. The parent is reachable via
    /// `base.parent`, so the sink is just a buffer the parent reads back on
    /// `child_done`.
    pub out: ExpansionOut,
    /// Working buffer for the *current* word being assembled. When a word
    /// boundary is hit (IFS split / glob result), it is flushed into `out`
    /// via `push_current_out`. A field that `end_field` ends with a [`FIELD_END`] stays here, for `finish_fields`.
    pub(crate) current_out: Vec<u8>,
    /// Byte offsets in `current_out` written by literal metacharacter atoms
    /// (`Asterisk`/`DoubleAsterisk`/`BraceBegin`/`Comma`/`BraceEnd`). Only
    /// these positions may act as pattern syntax in `do_brace_expand` or
    /// `transition_to_glob_state`; metacharacter bytes from any other source
    /// (JS interpolation, quoted text, `$var`, command substitution) are data
    /// and must not change the expansion structure or broaden the glob.
    /// [`FIELD_END`] entries are no offsets.
    pub(crate) meta_offsets: Vec<u32>,
    pub(crate) child_script: Option<NodeId>,
    /// Whether the in-flight command substitution was `"$(...)"` (no IFS
    /// splitting on its result). Only meaningful while `state == CmdSubst`.
    pub(crate) cmd_subst_quoted: bool,
    /// The atom is an assignment value (`A=v`, `export A=v`), so
    /// command-substitution output is not field split (POSIX 2.9.1).
    pub(crate) assign_ctx: bool,
    /// Set when a `""`/`''` literal
    /// was seen so an *empty* expansion is still pushed as an argv word.
    /// Without this, `$unset` and `""` are indistinguishable in
    /// [`ExpansionOut`] (both → `buf=[], bounds=[]`) and Cmd would push an
    /// empty arg for unset vars — diverging from POSIX field-splitting.
    pub(crate) has_quoted_empty: bool,
    earlier_fields: EarlierFields,
    /// Exit code of a sole-command-substitution arg — propagated to `Cmd`
    /// so `$(false)` as argv0 fails.
    pub(crate) out_exit_code: ExitCode,
}

#[derive(Default, strum::IntoStaticStr)]
pub enum ExpansionState {
    #[default]
    Idle,
    Walking,
    /// With the words that are open, when the `$(...)` is in the word of a `${NAME<op>word}`.
    CmdSubst(Option<Box<WordFrames>>),
    Glob,
    BraceExpand,
    Done,
    /// The parent inspects this on
    /// `child_done(_, 1)` to print the message.
    Err(Box<ShellErr>),
}

const _: () = assert!(size_of::<Expansion>() == 168);

/// What became of the fields of the word that ended before the one in `current_out`.
#[derive(Clone, Copy, PartialEq, Eq)]
enum EarlierFields {
    /// No field ended: a leading `~` is for the field in `current_out`.
    None,
    /// Each had no bytes and no `""`, so that `out` has no field.
    Empty,
    /// A field is in `out`. `has_quoted_empty` is then of the field in `current_out`.
    InOut,
}

/// In `meta_offsets`, in place of the offset of a metacharacter: a field ended. The next entry is the offset in
/// `current_out` where it ended. `end_field` adds the two entries when `finish_fields` is to expand the fields.
const FIELD_END: u32 = u32::MAX;
/// As [`FIELD_END`], for a field with a `""`.
const FIELD_END_QUOTED_EMPTY: u32 = u32::MAX - 1;

/// A field of `current_out`.
struct Field<'a> {
    bytes: &'a [u8],
    /// The offsets of its metacharacters in `current_out`.
    marks: &'a [u32],
    /// Where it starts in `current_out`.
    start: u32,
    has_quoted_empty: bool,
    /// No `FIELD_END` ends it: it is what `push_current_out` adds for an atom with no `FIELD_END`.
    is_last: bool,
}

impl Field<'_> {
    /// As `Expansion::has_glob_syntax`, for one field.
    fn has_glob_syntax(&self) -> bool {
        self.marks
            .iter()
            .any(|&mark| self.bytes[(mark - self.start) as usize] == b'*')
    }
}

/// Fields of `current_out`, in order: `meta_offsets` has a [`FIELD_END`] after each one but the last.
struct Fields<'a> {
    current_out: &'a [u8],
    /// The entries of `meta_offsets` from the next field on. `None`: the last field is given.
    marks: Option<&'a [u32]>,
    /// Where the next field starts in `current_out`.
    start: usize,
    has_quoted_empty: bool,
}

impl<'a> Fields<'a> {
    /// The fields from the one whose entries start at `first_mark` in `meta_offsets`.
    fn new(
        current_out: &'a [u8],
        meta_offsets: &'a [u32],
        first_mark: usize,
        has_quoted_empty: bool,
    ) -> Fields<'a> {
        Fields {
            current_out,
            marks: Some(&meta_offsets[first_mark..]),
            // The entry before is the end of the field before.
            start: first_mark
                .checked_sub(1)
                .map_or(0, |end| meta_offsets[end] as usize),
            has_quoted_empty,
        }
    }
}

impl<'a> Iterator for Fields<'a> {
    type Item = Field<'a>;

    fn next(&mut self) -> Option<Field<'a>> {
        let marks = self.marks?;
        let field_end = marks
            .iter()
            .position(|&mark| mark >= FIELD_END_QUOTED_EMPTY);
        let (marks, end, has_quoted_empty) = match field_end {
            Some(at) => {
                self.marks = Some(&marks[at + 2..]);
                let end = marks[at + 1] as usize;
                (&marks[..at], end, marks[at] == FIELD_END_QUOTED_EMPTY)
            }
            None => {
                self.marks = None;
                (marks, self.current_out.len(), self.has_quoted_empty)
            }
        };
        let field = Field {
            bytes: &self.current_out[self.start..end],
            marks,
            start: self.start as u32,
            has_quoted_empty,
            is_last: field_end.is_none(),
        };
        self.start = end;
        Some(field)
    }
}

/// In an atom for brace expansion, before a byte that is not text: a `*` of the script, [`FIELD_END_IN_BRACES`],
/// [`FIELD_END_QUOTED_EMPTY_IN_BRACES`], or `BRACE_TAG` itself, which is then data.
const BRACE_TAG: u8 = 0x01;
const FIELD_END_IN_BRACES: u8 = b'|';
const FIELD_END_QUOTED_EMPTY_IN_BRACES: u8 = b'"';

/// The word of a `${NAME<op>word}` while it expands.
struct WordFrame {
    /// `None`: the atoms of `node` itself, after the first [`FIELD_END`]. Only `idx` has a use then.
    param: Option<&'static ast::ParamExp>,
    /// The next atom of the word.
    idx: u32,
    /// Where the word starts in `current_out`.
    start: u32,
    /// Where the word starts in `meta_offsets`.
    meta_start: u32,
    /// Whitespace and a `$(...)` in the word end no argument.
    one_string: bool,
    /// `has_quoted_empty` before the word.
    had_quoted_empty: bool,
}

impl WordFrame {
    /// The frame for the atoms of `node`, where `idx` is the one that gave the first [`FIELD_END`].
    fn of_node(idx: u32) -> WordFrame {
        WordFrame {
            param: None,
            idx,
            start: 0,
            meta_start: 0,
            one_string: false,
            had_quoted_empty: false,
        }
    }
}

/// The words that are open: a word in the word of another form puts that one in `outer`.
pub struct WordFrames {
    top: WordFrame,
    outer: Vec<WordFrame>,
}

#[derive(Default)]
pub(crate) struct ExpansionOut {
    pub(crate) buf: Vec<u8>,
    /// Word boundaries within `buf` (for IFS splitting / glob results).
    pub(crate) bounds: Vec<u32>,
    /// Set when the atom is a sole `$(…)`
    /// that exited non-zero, so [`Cmd::child_done`] can propagate it as the
    /// command's exit code when that substitution was argv0 and argv is
    /// otherwise empty.
    pub(crate) out_exit_code: ExitCode,
    /// When `buf`/`bounds` are both
    /// empty, this distinguishes `""` (push one empty arg) from `$unset`
    /// (push no arg). See [`Expansion::has_quoted_empty`].
    pub(crate) has_quoted_empty: bool,
}

impl Expansion {
    pub(crate) fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: &ast::Atom,
        parent: NodeId,
        assign_ctx: bool,
    ) -> NodeId {
        interp.alloc_node(Node::Expansion(Expansion {
            base: Base::new(parent, shell),
            node: bun_ptr::BackRef::new(node),
            state: ExpansionState::Idle,
            word_idx: 0,
            out: ExpansionOut::default(),
            current_out: Vec::new(),
            meta_offsets: Vec::new(),
            child_script: None,
            cmd_subst_quoted: false,
            assign_ctx,
            has_quoted_empty: false,
            earlier_fields: EarlierFields::None,
            out_exit_code: 0,
        }))
    }

    pub(crate) fn start(_interp: &Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    /// Walks the
    /// atom, appending no-IO expansions to `current_out` and yielding to a
    /// child `Script` whenever a `$(...)` is encountered. Re-entered after
    /// `child_done` advances `word_idx`.
    pub(crate) fn next(interp: &Interpreter, this: NodeId) -> Yield {
        loop {
            let event_loop = interp.event_loop;
            let command_ctx = interp.command_ctx;
            let me = interp.as_expansion_mut(this);
            match me.state {
                ExpansionState::Idle => {
                    me.state = ExpansionState::Walking;
                    continue;
                }
                ExpansionState::CmdSubst(_) | ExpansionState::Glob => {
                    // Re-entered while a child is in flight.
                    return Yield::suspended();
                }
                ExpansionState::BraceExpand => {
                    Self::do_brace_expand(me);
                    // brace + glob composes: after pushing the literal brace
                    // variants, glob the original pattern. The normal glob path likewise calls
                    // `transition_to_glob_state` directly (see below).
                    if matches!(me.state, ExpansionState::Glob) {
                        return Self::transition_to_glob_state(interp, this);
                    }
                    continue;
                }
                ExpansionState::Done | ExpansionState::Err(_) => break,
                ExpansionState::Walking => {}
            }

            // Copy the BackRef out so `atom` borrows a local, leaving `me`
            // free for the `&mut me.*` field writes below.
            let node = me.node;
            let atom = node.get();
            let atoms_len = atom.atoms_len();
            // Leading `~` in a compound is skipped during the walk and
            // post-processed below.
            let leading_tilde = matches!(atom, ast::Atom::Compound(c)
                if c.atoms.first().is_some_and(|a| matches!(a, ast::SimpleAtom::Tilde)));
            if me.word_idx == 0 && leading_tilde {
                me.word_idx = 1;
            }

            while me.word_idx < atoms_len {
                let simple: &ast::SimpleAtom = match atom {
                    ast::Atom::Simple(s) => s,
                    ast::Atom::Compound(c) => &c.atoms[me.word_idx as usize],
                };
                let shell = me.base.shell();
                let is_deferred = interp.vm_args_utf8.with_mut(|vm_args_utf8| {
                    Self::expand_simple_no_io(
                        shell,
                        simple,
                        &mut me.current_out,
                        &mut me.meta_offsets,
                        &mut me.has_quoted_empty,
                        true,
                        event_loop,
                        command_ctx,
                        vm_args_utf8,
                    )
                });
                if !is_deferred {
                    me.word_idx += 1;
                    continue;
                }
                return match simple {
                    ast::SimpleAtom::CmdSubst(sub) => {
                        Self::start_cmd_subst(interp, this, sub, None)
                    }
                    _ => Self::expand_param_atom(interp, this),
                };
            }

            // All sub-atoms expanded — post-process leading tilde then finish.
            if leading_tilde && me.earlier_fields == EarlierFields::None {
                Self::apply_leading_tilde(me);
            }
            // Brace expansion
            // first, then glob, else flush as a single word.
            if atom.has_brace_expansion() {
                me.state = ExpansionState::BraceExpand;
                continue;
            }
            if atom.has_glob_expansion() {
                return Self::transition_to_glob_state(interp, this);
            }
            Self::push_current_out(me);
            me.state = ExpansionState::Done;
        }
        let parent = interp.as_expansion(this).base.parent;
        let exit: ExitCode = if matches!(interp.as_expansion(this).state, ExpansionState::Err(_)) {
            1
        } else {
            0
        };
        interp.child_done(parent, this, exit)
    }

    /// Starts the `Script` of a `$(...)`, with its stdout piped into a buffer that `child_done` reads.
    #[inline(always)] // `next` runs this for each `$(...)`, and `walk_words` is a second caller.
    fn start_cmd_subst(
        interp: &Interpreter,
        this: NodeId,
        sub: &ast::CmdSubst,
        words: Option<Box<WordFrames>>,
    ) -> Yield {
        let me = interp.as_expansion_mut(this);
        me.state = ExpansionState::CmdSubst(words);
        me.cmd_subst_quoted = sub.quoted;

        let io = IO {
            stdin: interp.root_io().stdin.clone(),
            stdout: OutKind::Pipe,
            stderr: interp.root_io().stderr.clone(),
        };
        let duped = match me
            .base
            .shell_mut()
            .dupe_for_subshell(&io, ShellExecEnvKind::CmdSubst)
        {
            Ok(d) => d,
            Err(e) => {
                drop(io);
                interp.throw(ShellErr::new_sys(&e));
                return Yield::Failed(this);
            }
        };
        let script = Script::init(interp, duped, &sub.script, this, io);
        interp.as_expansion_mut(this).child_script = Some(script);
        Script::start(interp, script)
    }

    /// Puts the leading `~`, which the walk left out, in front of the first field.
    #[inline(always)] // `next` runs this for each word with a leading `~`, and `end_field` is a second caller.
    fn apply_leading_tilde(me: &mut Expansion) {
        let home = me.base.shell().get_homedir();
        let len_before = me.current_out.len();
        match me.current_out.first() {
            Some(b'/') | Some(b'\\') => {
                me.current_out.splice(0..0, home.slice().iter().copied());
            }
            Some(_) => me.current_out.insert(0, b'~'),
            // `~""` expands to $HOME, but `~$unset` expands to nothing (word is dropped).
            None if me.has_quoted_empty => {
                me.current_out.extend_from_slice(home.slice());
            }
            None => {}
        }
        // The first two arms prepend: shift the recorded metacharacter offsets to the same bytes.
        let prepended = (me.current_out.len() - len_before) as u32;
        if prepended != 0 {
            for off in &mut me.meta_offsets {
                *off += prepended;
            }
        }
        home.deref();
    }

    /// Re-tokenize `current_out` (the
    /// fully-expanded word with `{`/`,`/`}` markers preserved by
    /// `expand_simple_no_io`) and push each variant as a separate argv word.
    fn do_brace_expand(me: &mut Expansion) {
        use bun_shell_parser::braces;
        if me.current_out.is_empty() {
            Self::push_current_out(me);
            me.state = ExpansionState::Done;
            return;
        }
        // Only the `{`/`,`/`}` bytes recorded in `meta_offsets` (written
        // by literal BraceBegin/Comma/BraceEnd atoms) are brace-expansion
        // metacharacters. Bytes from Text/Var/cmd-subst expansion — notably JS
        // `${...}` interpolations — are data: backslash-escape them so the
        // brace lexer cannot be steered into emitting extra argv words.
        // (`meta_offsets` also records literal `*`/`**` positions for the glob
        // path; those are inert here since `*` is not in the escape set.)
        let mut escaped: Vec<u8> = Vec::with_capacity(me.current_out.len());
        let mut next_meta = 0usize;
        for (i, &b) in me.current_out.iter().enumerate() {
            if next_meta < me.meta_offsets.len() && me.meta_offsets[next_meta] as usize == i {
                next_meta += 1;
            } else if matches!(b, b'{' | b'}' | b',' | b'\\') {
                escaped.push(b'\\');
            }
            escaped.push(b);
        }
        let brace_str = &escaped[..];
        let mut lexer_output = if bun_core::is_all_ascii(brace_str) {
            bun_core::handle_oom(braces::Lexer::tokenize(brace_str))
        } else {
            bun_core::handle_oom(
                braces::NewLexer::<{ braces::StringEncoding::Wtf8 }>::tokenize(brace_str),
            )
        };
        let count = braces::calculate_expanded_amount(&lexer_output.tokens[..]);
        // Hard cap before preallocation: `calculate_expanded_amount` saturates
        // to `u32::MAX`, so a tiny nested input can otherwise request a huge `Vec`.
        const MAX_BRACE_EXPANSIONS: u32 = 65536;
        if count > MAX_BRACE_EXPANSIONS {
            let msg = format!("too many brace expansions ({count} > {MAX_BRACE_EXPANSIONS})");
            me.state = ExpansionState::Err(Box::new(ShellErr::Custom(msg.into_bytes().into())));
            return;
        }
        let count = count as usize;
        let expanded: Vec<Vec<u8>> = if count == 0 {
            // No `{...}` group formed an expansion (no top-level comma, or
            // unbalanced); emit the word unchanged. `expand` would index
            // `out[0]` of an empty slice here. Keep `current_out` for glob.
            vec![me.current_out.clone()]
        } else {
            let mut expanded: Vec<Vec<u8>> = (0..count).map(|_| Vec::new()).collect();
            let arena = bun_alloc::Arena::new();
            if let Err(e) = braces::expand(
                &arena,
                &mut lexer_output.tokens[..],
                &mut expanded[..],
                lexer_output.contains_nested,
            ) {
                let msg = match e {
                    braces::ParserError::TooManyBraces => "too many braces in brace expansion",
                    // The word has more than `u16::MAX` brace tokens.
                    braces::ParserError::UnexpectedToken => {
                        "unexpected token while expanding braces"
                    }
                    braces::ParserError::OutOfMemory => bun_core::out_of_memory(),
                };
                me.state = ExpansionState::Err(Box::new(ShellErr::Custom(msg.as_bytes().into())));
                return;
            }
            drop(arena);
            expanded
        };

        // Push each variant as its own word; word boundaries are recorded
        // via `bounds`.
        for s in expanded {
            Self::push_variant(me, &s);
        }

        let node = me.node;
        let atom = node.get();
        if atom.has_glob_expansion() && Self::has_glob_syntax(me) {
            // brace + glob composes. Keep
            // `current_out` (the original pattern, e.g. `src/*.{ts,tsx}`) so
            // the glob walker brace-expands and globs it; its matches are
            // appended after the literal brace variants already pushed above.
            me.state = ExpansionState::Glob;
        } else {
            me.current_out.clear();
            me.state = ExpansionState::Done;
        }
    }

    /// Build the pattern handed to the glob walker from `current_out`,
    /// neutralizing every glob metacharacter byte that was *not* written by a
    /// literal metacharacter atom (those positions are recorded in
    /// `meta_offsets`). Metacharacters arriving via JS `${...}` interpolation,
    /// `$var`, command substitution, or quoted text are data and must not be
    /// able to broaden the match. Mirrors `do_brace_expand`'s escaping loop,
    /// but the glob matcher has no general backslash-escape that survives
    /// `build_pattern_components` on every platform, so each byte is wrapped
    /// in a single-character class (`[c]`) — or a one-branch brace group for
    /// a component-leading `!` — which the matcher provably treats as that
    /// literal character.
    /// `current_out` itself is not mutated: the no-match error message and the
    /// assignment-position literal fallback keep using the original word.
    fn neutralize_glob_metachars(current_out: &[u8], meta_offsets: &[u32]) -> Vec<u8> {
        let mut pattern: Vec<u8> = Vec::with_capacity(current_out.len());
        let mut next_meta = 0usize;
        for (i, &b) in current_out.iter().enumerate() {
            if next_meta < meta_offsets.len() && meta_offsets[next_meta] as usize == i {
                next_meta += 1;
                pattern.push(b);
                continue;
            }
            match b {
                // `[c]` is a single-character class containing only `c`.
                b'*' | b'?' | b'[' | b']' | b'{' | b'}' | b',' => {
                    pattern.extend_from_slice(&[b'[', b, b']']);
                }
                // The shell has no literal atom for `(` in a word, so here it is always data. It only means something to the
                // matcher after one of these, as the start of an extglob group, and without a group `)` and `|` are plain
                // characters. Any other `(` stays bare, so that `Dropbox (Personal)` is still a literal component, which
                // the walker opens by name: that follows a symlink, and ignores case where the file system does.
                b'(' if matches!(pattern.last(), Some(b'?' | b'*' | b'+' | b'@' | b'!')) => {
                    pattern.extend_from_slice(b"[(]");
                }
                // `[!]`/`[^]` would be a negated class, so `!` cannot use the
                // class wrapper. Only a `!` at the start of a path component
                // (the same split `build_pattern_components` performs) can act
                // as pattern syntax — the matcher's negation loop — so wrap
                // that one in a one-branch brace group whose sole branch is
                // the literal `!`. Every other `!` already matches literally
                // (a `(` after it is wrapped, so it can't start `!(`)
                // and is emitted bare: wrapping each one costs a brace-stack
                // slot per byte, and a run of more than 10 interpolated `!`
                // would overflow the matcher's bounded brace stack and turn
                // the whole word into a spurious no-match.
                b'!' => {
                    let starts_component = pattern
                        .last()
                        .is_none_or(|&prev| bun_core::path_sep::is_sep_native(prev));
                    if starts_component {
                        pattern.extend_from_slice(b"{!}");
                    } else {
                        pattern.push(b'!');
                    }
                }
                // `[\\]` is a class containing an escaped `\`; the 3-byte
                // `[\]` would mis-parse as a class containing an escaped `]`.
                #[cfg(not(windows))]
                b'\\' => pattern.extend_from_slice(b"[\\\\]"),
                // On Windows `\` is a native path separator (same pass-through
                // policy as `/`); wrapping it would let the component splitter
                // cut the synthesized brackets apart.
                _ => pattern.push(b),
            }
        }
        pattern
    }

    /// Whether the field in `current_out` has a `*` of the script. The hint of the atom is for the whole word.
    fn has_glob_syntax(me: &Expansion) -> bool {
        me.meta_offsets
            .iter()
            .any(|&offset| me.current_out.get(offset as usize) == Some(&b'*'))
    }

    /// Kick off an off-thread
    /// glob walk for the assembled pattern in `current_out`.
    fn transition_to_glob_state(interp: &Interpreter, this: NodeId) -> Yield {
        use crate::shell::dispatch_tasks::ShellGlobTask;
        let pattern: Vec<u8>;
        let cwd: Vec<u8>;
        {
            let me = interp.as_expansion_mut(this);
            if !Self::has_glob_syntax(me) {
                Self::push_current_out(me);
                me.state = ExpansionState::Done;
                return Yield::Next(this);
            }
            me.state = ExpansionState::Glob;
            pattern = Self::neutralize_glob_metachars(&me.current_out, &me.meta_offsets);
            cwd = me.base.shell().cwd().to_vec();
        }
        let walker = match bun_glob::BunGlobWalkerZ::init_with_cwd(
            &pattern, &cwd, false, false, false, false, false, None,
        ) {
            Ok(Ok(w)) => w,
            Ok(Err(e)) => {
                interp.as_expansion_mut(this).state =
                    ExpansionState::Err(Box::new(ShellErr::new_sys(&e)));
                return Yield::Next(this);
            }
            Err(e) => {
                interp.as_expansion_mut(this).state = ExpansionState::Err(Box::new(
                    ShellErr::Custom(e.to_string().into_bytes().into()),
                ));
                return Yield::Next(this);
            }
        };
        ShellGlobTask::create_and_schedule(interp, this, walker);
        Yield::suspended()
    }

    /// Appends the no-IO expansion of
    /// one [`ast::SimpleAtom`] to `out`. Returns `true` for `CmdSubst` so the
    /// caller spawns a `Script` for it, and for a `Param`, which goes to `expand_param_atom`.
    #[inline(always)]
    fn expand_simple_no_io(
        shell: &ShellExecEnv,
        atom: &ast::SimpleAtom,
        out: &mut Vec<u8>,
        meta_offsets: &mut Vec<u32>,
        has_quoted_empty: &mut bool,
        expand_tilde: bool,
        event_loop: EventLoopHandle,
        command_ctx: *mut bun_options_types::context::ContextData,
        vm_args_utf8: &mut Vec<bun_core::Utf8Bytes<'static>>,
    ) -> bool {
        match atom {
            ast::SimpleAtom::Text(txt) => out.extend_from_slice(txt),
            ast::SimpleAtom::QuotedEmpty => {
                // Sets `has_quoted_empty = true` so an empty word is still pushed
                // as an arg. The flag is *required* — without it Cmd cannot
                // tell `""` (one empty arg) from `$unset` (no arg), since
                // both leave `out.buf` empty.
                *has_quoted_empty = true;
            }
            ast::SimpleAtom::Var(label) => {
                // Spec `expandVar`: shell_env first, then export_env, else "".
                let key = EnvStr::init_slice(label);
                if let Some(v) = shell.shell_env.get(key) {
                    out.extend_from_slice(v.slice());
                    v.deref();
                } else if let Some(v) = shell.export_env.get(EnvStr::init_slice(label)) {
                    out.extend_from_slice(v.slice());
                    v.deref();
                }
            }
            ast::SimpleAtom::VarArgv(int) => {
                // SAFETY: `command_ctx` is the live VM ctx; `vm_args_utf8` borrows it.
                Interpreter::append_var_argv(out, *int, event_loop, command_ctx, vm_args_utf8);
            }
            ast::SimpleAtom::Param(_) | ast::SimpleAtom::ParamSpace(_) => return true,
            ast::SimpleAtom::Asterisk => {
                meta_offsets.push(out.len() as u32);
                out.push(b'*');
            }
            ast::SimpleAtom::DoubleAsterisk => {
                // Both bytes must be recorded or `neutralize_glob_metachars`
                // would wrap the second `*`, breaking `**`.
                meta_offsets.push(out.len() as u32);
                meta_offsets.push(out.len() as u32 + 1);
                out.extend_from_slice(b"**");
            }
            ast::SimpleAtom::BraceBegin => {
                meta_offsets.push(out.len() as u32);
                out.push(b'{');
            }
            ast::SimpleAtom::BraceEnd => {
                meta_offsets.push(out.len() as u32);
                out.push(b'}');
            }
            ast::SimpleAtom::Comma => {
                meta_offsets.push(out.len() as u32);
                out.push(b',');
            }
            ast::SimpleAtom::Tilde => {
                if expand_tilde {
                    let home = shell.get_homedir();
                    out.extend_from_slice(home.slice());
                    home.deref();
                } else {
                    out.push(b'~');
                }
            }
            ast::SimpleAtom::CmdSubst(_) => return true,
        }
        false
    }

    /// Expands the `Param` at `word_idx`.
    #[cold]
    fn expand_param_atom(interp: &Interpreter, this: NodeId) -> Yield {
        let me = interp.as_expansion_mut(this);
        let node = me.node;
        let param = match node.get() {
            ast::Atom::Simple(ast::SimpleAtom::Param(param)) => *param,
            ast::Atom::Compound(compound) => match compound.atoms[me.word_idx as usize] {
                ast::SimpleAtom::Param(param) => param,
                _ => unreachable!("expand_simple_no_io leaves a Param"),
            },
            ast::Atom::Simple(_) => unreachable!("expand_simple_no_io leaves a Param"),
        };
        let one_string = Self::is_one_string(interp, me);
        match Self::open_word(interp, me, param, one_string) {
            Some(top) => Self::walk_words(
                interp,
                this,
                WordFrames {
                    top,
                    outer: Vec::new(),
                },
            ),
            None => {
                me.word_idx += 1;
                Yield::Next(this)
            }
        }
    }

    /// Whether the word of a form that is an atom of `node` is one string: an assignment value and a `[[ ]]` operand are.
    fn is_one_string(interp: &Interpreter, me: &Expansion) -> bool {
        me.assign_ctx || matches!(interp.node(me.base.parent), Node::CondExpr(_))
    }

    /// Appends the value of the parameter when that is the result. Else the word is the result: gives its frame.
    fn open_word(
        interp: &Interpreter,
        me: &mut Expansion,
        param: &'static ast::ParamExp,
        one_string: bool,
    ) -> Option<WordFrame> {
        let len = me.current_out.len();
        let is_set = match param.target {
            ast::ParamTarget::Name(name) => {
                let shell = me.base.shell();
                let value = shell
                    .shell_env
                    .get(EnvStr::init_slice(name))
                    .or_else(|| shell.export_env.get(EnvStr::init_slice(name)));
                match value {
                    Some(value) => {
                        me.current_out.extend_from_slice(value.slice());
                        value.deref();
                        true
                    }
                    None => false,
                }
            }
            ast::ParamTarget::Positional(int) => interp.vm_args_utf8.with_mut(|vm_args_utf8| {
                Interpreter::append_var_argv(
                    &mut me.current_out,
                    int,
                    interp.event_loop,
                    interp.command_ctx,
                    vm_args_utf8,
                )
            }),
        };
        let is_absent = param.op.is_absent(is_set, me.current_out.len() == len);
        let is_alternate = param.op.action == ast::ParamAction::Alternate;
        if is_absent == is_alternate {
            // `+` gives nothing for an absent parameter. The other operators give the value of a present one.
            if is_alternate {
                me.current_out.truncate(len);
            }
            return None;
        }
        me.current_out.truncate(len);
        Some(WordFrame {
            param: Some(param),
            idx: 0,
            start: len as u32,
            meta_start: me.meta_offsets.len() as u32,
            one_string: one_string
                || matches!(
                    param.op.action,
                    ast::ParamAction::Assign | ast::ParamAction::Error
                ),
            had_quoted_empty: me.has_quoted_empty,
        })
    }

    /// Expands the open words, up to the end of the outermost one or to a `$(...)`, which `child_done` resumes from.
    /// After a [`FIELD_END`], `next` has no step for the fields: the rest of the atoms of `node` expand here too, up to
    /// `finish_fields`.
    #[cold]
    fn walk_words(interp: &Interpreter, this: NodeId, mut words: WordFrames) -> Yield {
        loop {
            let me = interp.as_expansion_mut(this);
            let node = me.node;
            let atom = match words.top.param {
                Some(param) => param.word.get(words.top.idx as usize),
                None => match node.get() {
                    ast::Atom::Compound(compound) => compound.atoms.get(words.top.idx as usize),
                    ast::Atom::Simple(_) => None,
                },
            };
            let Some(atom) = atom else {
                let Some(param) = words.top.param else {
                    return Self::finish_fields(interp, this);
                };
                if !Self::close_word(me, param, &words.top) {
                    return Yield::Next(this);
                }
                words.top = match words.outer.pop() {
                    Some(outer) => outer,
                    None if Self::has_field_end(me) => WordFrame::of_node(me.word_idx),
                    None => {
                        me.word_idx += 1;
                        return Yield::Next(this);
                    }
                };
                words.top.idx += 1;
                continue;
            };
            match atom {
                ast::SimpleAtom::Param(param) => {
                    let one_string = match words.top.param {
                        Some(_) => words.top.one_string,
                        None => Self::is_one_string(interp, me),
                    };
                    if let Some(inner) = Self::open_word(interp, me, *param, one_string) {
                        words.outer.push(core::mem::replace(&mut words.top, inner));
                        continue;
                    }
                }
                ast::SimpleAtom::ParamSpace(space) => {
                    if words.top.one_string {
                        me.current_out.extend_from_slice(space);
                    } else {
                        Self::end_field(me);
                    }
                }
                ast::SimpleAtom::CmdSubst(sub) => {
                    // A script with no statement ends inside `Script::start`. `child_done` would then continue this walk inside this call.
                    if !sub.script.stmts.is_empty() {
                        return Self::start_cmd_subst(interp, this, sub, Some(Box::new(words)));
                    }
                }
                _ => {
                    let shell = me.base.shell();
                    let _ = interp.vm_args_utf8.with_mut(|vm_args_utf8| {
                        Self::expand_simple_no_io(
                            shell,
                            atom,
                            &mut me.current_out,
                            &mut me.meta_offsets,
                            &mut me.has_quoted_empty,
                            true,
                            interp.event_loop,
                            interp.command_ctx,
                            vm_args_utf8,
                        )
                    });
                }
            }
            words.top.idx += 1;
        }
    }

    /// Ends the word of `param`. The word of a `=` is assigned and the word of a `?` is the error. `false`: `state` is an error.
    fn close_word(me: &mut Expansion, param: &ast::ParamExp, frame: &WordFrame) -> bool {
        if !matches!(
            param.op.action,
            ast::ParamAction::Assign | ast::ParamAction::Error
        ) {
            return true;
        }
        // The word is a value here: a `*` or a `""` in it is not syntax of the argument.
        let word = me.current_out.split_off(frame.start as usize);
        me.meta_offsets.truncate(frame.meta_start as usize);
        me.has_quoted_empty = frame.had_quoted_empty;

        use std::io::Write as _;
        let mut message: Vec<u8> = Vec::new();
        match (param.op.action, param.target) {
            (ast::ParamAction::Assign, ast::ParamTarget::Name(name)) => {
                me.current_out.extend_from_slice(&word);
                let value = EnvStr::init_ref_counted(word.into_boxed_slice());
                me.base
                    .shell_mut()
                    .assign_var(EnvStr::init_slice(name), value, AssignCtx::Shell);
                value.deref();
                return true;
            }
            (ast::ParamAction::Assign, ast::ParamTarget::Positional(int)) => {
                // A write to a `Vec` cannot fail.
                let _ = write!(message, "${int}: cannot assign in this way");
            }
            (_, target) => {
                match target {
                    ast::ParamTarget::Name(name) => message.extend_from_slice(name),
                    ast::ParamTarget::Positional(int) => {
                        let _ = write!(message, "{int}");
                    }
                }
                message.extend_from_slice(b": ");
                if !word.is_empty() {
                    message.extend_from_slice(&word);
                } else if param.op.colon {
                    message.extend_from_slice(b"parameter null or not set");
                } else {
                    message.extend_from_slice(b"parameter not set");
                }
            }
        }
        me.state = ExpansionState::Err(Box::new(ShellErr::Custom(message.into_boxed_slice())));
        false
    }

    /// Ends the field in `current_out` before the end of the walk. When the atom has a brace group of the script, or
    /// `current_out` has a metacharacter of the script for a glob, the field stays there with a [`FIELD_END`]:
    /// `finish_fields` expands it after the walk.
    fn end_field(me: &mut Expansion) {
        let node = me.node;
        let atom = node.get();
        if me.earlier_fields == EarlierFields::None {
            me.earlier_fields = EarlierFields::Empty;
            if matches!(atom, ast::Atom::Compound(c)
                if c.atoms.first().is_some_and(|a| matches!(a, ast::SimpleAtom::Tilde)))
            {
                Self::apply_leading_tilde(me);
            }
        }
        if !atom.has_brace_expansion() && (!atom.has_glob_expansion() || me.meta_offsets.is_empty())
        {
            return Self::add_ended_field(me);
        }
        // The field is of a `$(...)` that `next` started: `child_done` goes on in `walk_words`, as after one in the word of a form.
        if let ExpansionState::CmdSubst(words @ None) = &mut me.state {
            *words = Some(Box::new(WordFrames {
                top: WordFrame::of_node(me.word_idx),
                outer: Vec::new(),
            }));
        }
        let field_end = if me.has_quoted_empty {
            FIELD_END_QUOTED_EMPTY
        } else {
            FIELD_END
        };
        me.meta_offsets
            .extend_from_slice(&[field_end, me.current_out.len() as u32]);
        me.has_quoted_empty = false;
    }

    /// Whether `end_field` left a [`FIELD_END`].
    fn has_field_end(me: &Expansion) -> bool {
        me.meta_offsets
            .iter()
            .any(|&mark| mark >= FIELD_END_QUOTED_EMPTY)
    }

    /// Adds the field in `current_out`, which is not the last one, to `out`. With no bytes and no `""`, it is no argument.
    fn add_ended_field(me: &mut Expansion) {
        if me.current_out.is_empty() && !me.has_quoted_empty {
            return;
        }
        Self::push_current_out(me);
        me.has_quoted_empty = false;
        me.earlier_fields = EarlierFields::InOut;
    }

    /// The end of the walk of an atom with a [`FIELD_END`]: after brace expansion, its fields go to `out`.
    #[cold]
    fn finish_fields(interp: &Interpreter, this: NodeId) -> Yield {
        let me = interp.as_expansion_mut(this);
        if me.node.get().has_brace_expansion() && !Self::expand_braces_of_fields(me) {
            return Yield::Next(this);
        }
        me.word_idx = 0;
        Self::add_fields(interp, this, false)
    }

    /// Brace expansion for an atom with a [`FIELD_END`]. The variants take the place of the atom in `current_out`, with
    /// a `FIELD_END` between two of them, and each one has the field ends of the atom. `false`: `state` is an error.
    /// `do_brace_expand` is inline in `next`, the step of each word: it stays as it is, for an atom with no `FIELD_END`.
    fn expand_braces_of_fields(me: &mut Expansion) -> bool {
        use bun_shell_parser::braces;
        // As in `do_brace_expand`, a `{`, `,` or `}` that is not of the script is data. A `*` of the script and a
        // field end go through the expansion behind a `BRACE_TAG`.
        let mut tagged: Vec<u8> = Vec::with_capacity(me.current_out.len() + me.meta_offsets.len());
        let marks = &me.meta_offsets[..];
        let mut next_mark = 0usize;
        for i in 0..=me.current_out.len() {
            while let [field_end @ (FIELD_END | FIELD_END_QUOTED_EMPTY), end, ..] =
                marks[next_mark..]
                && end as usize == i
            {
                next_mark += 2;
                let field_end = if field_end == FIELD_END {
                    FIELD_END_IN_BRACES
                } else {
                    FIELD_END_QUOTED_EMPTY_IN_BRACES
                };
                tagged.extend_from_slice(&[BRACE_TAG, field_end]);
            }
            let Some(&b) = me.current_out.get(i) else {
                break;
            };
            if marks.get(next_mark) == Some(&(i as u32)) {
                next_mark += 1;
                if b == b'*' {
                    tagged.push(BRACE_TAG);
                }
            } else if matches!(b, b'{' | b'}' | b',' | b'\\') {
                tagged.push(b'\\');
            } else if b == BRACE_TAG {
                tagged.push(BRACE_TAG);
            }
            tagged.push(b);
        }
        let mut lexer_output = if bun_core::is_all_ascii(&tagged) {
            bun_core::handle_oom(braces::Lexer::tokenize(&tagged))
        } else {
            bun_core::handle_oom(
                braces::NewLexer::<{ braces::StringEncoding::Wtf8 }>::tokenize(&tagged),
            )
        };
        let count = braces::calculate_expanded_amount(&lexer_output.tokens[..]);
        const MAX_BRACE_EXPANSIONS: u32 = 65536;
        if count > MAX_BRACE_EXPANSIONS {
            let msg = format!("too many brace expansions ({count} > {MAX_BRACE_EXPANSIONS})");
            me.state = ExpansionState::Err(Box::new(ShellErr::Custom(msg.into_bytes().into())));
            return false;
        }
        if count == 0 {
            // No group of the atom has a `,`: the atom is its one variant.
            return true;
        }
        let mut variants: Vec<Vec<u8>> = (0..count).map(|_| Vec::new()).collect();
        let arena = bun_alloc::Arena::new();
        if let Err(e) = braces::expand(
            &arena,
            &mut lexer_output.tokens[..],
            &mut variants[..],
            lexer_output.contains_nested,
        ) {
            let msg = match e {
                braces::ParserError::TooManyBraces => "too many braces in brace expansion",
                braces::ParserError::UnexpectedToken => "unexpected token while expanding braces",
                braces::ParserError::OutOfMemory => bun_core::out_of_memory(),
            };
            me.state = ExpansionState::Err(Box::new(ShellErr::Custom(msg.as_bytes().into())));
            return false;
        }
        drop(arena);

        let between_variants = if me.has_quoted_empty {
            FIELD_END_QUOTED_EMPTY
        } else {
            FIELD_END
        };
        me.current_out.clear();
        me.meta_offsets.clear();
        for (n, variant) in variants.iter().enumerate() {
            if n != 0 {
                me.meta_offsets
                    .extend_from_slice(&[between_variants, me.current_out.len() as u32]);
            }
            let mut bytes = variant.iter().copied();
            while let Some(b) = bytes.next() {
                if b != BRACE_TAG {
                    me.current_out.push(b);
                    continue;
                }
                let end = me.current_out.len() as u32;
                match bytes.next() {
                    Some(b'*') => {
                        me.meta_offsets.push(end);
                        me.current_out.push(b'*');
                    }
                    Some(FIELD_END_IN_BRACES) => {
                        me.meta_offsets.extend_from_slice(&[FIELD_END, end]);
                    }
                    Some(FIELD_END_QUOTED_EMPTY_IN_BRACES) => {
                        me.meta_offsets
                            .extend_from_slice(&[FIELD_END_QUOTED_EMPTY, end]);
                    }
                    Some(data) => me.current_out.push(data),
                    None => {}
                }
            }
        }
        true
    }

    /// Adds the fields of `current_out` from `word_idx` on to `out`, up to one with a `*` of the script. That one is for
    /// a glob walk: `on_glob_walk_done` adds its matches and comes back here, with `after_walk`, for the fields after it.
    #[cold]
    fn add_fields(interp: &Interpreter, this: NodeId, after_walk: bool) -> Yield {
        let me = interp.as_expansion_mut(this);
        if after_walk && interp.failed() {
            // The script failed: the rest of the word is not expanded.
            me.state = ExpansionState::Done;
            return Yield::Next(this);
        }
        let current_out = core::mem::take(&mut me.current_out);
        let meta_offsets = core::mem::take(&mut me.meta_offsets);
        let last_has_quoted_empty = me.has_quoted_empty;
        let mut first_mark = me.word_idx as usize;
        let mut fields = Fields::new(
            &current_out,
            &meta_offsets,
            first_mark,
            last_has_quoted_empty,
        );
        if after_walk && let Some(walked) = fields.next() {
            first_mark += walked.marks.len() + 2;
        }
        let mut pattern = None;
        for field in fields {
            if field.has_glob_syntax() {
                pattern = Some(field);
                break;
            }
            first_mark += field.marks.len() + 2;
            me.current_out.extend_from_slice(field.bytes);
            me.has_quoted_empty = field.has_quoted_empty;
            if field.is_last {
                Self::push_current_out(me);
            } else {
                Self::add_ended_field(me);
            }
        }
        let Some(pattern) = pattern else {
            me.state = ExpansionState::Done;
            return Yield::Next(this);
        };
        // `transition_to_glob_state` walks what `current_out` has. After it, all fields are back there, and `word_idx`
        // says which one has the walk.
        me.current_out.extend_from_slice(pattern.bytes);
        me.meta_offsets
            .extend(pattern.marks.iter().map(|&mark| mark - pattern.start));
        me.word_idx = first_mark as u32;
        let walk = Self::transition_to_glob_state(interp, this);
        let me = interp.as_expansion_mut(this);
        me.current_out = current_out;
        me.meta_offsets = meta_offsets;
        me.has_quoted_empty = last_has_quoted_empty;
        walk
    }

    /// Flush `current_out` into `out`
    /// as the next argv word. The word boundary is recorded as the *previous*
    /// end-offset so the consumer's `[prev..bound]` slicing reconstructs each
    /// word and the trailing `[prev..]` slice yields the final one.
    fn push_current_out(me: &mut Expansion) {
        if me.earlier_fields == EarlierFields::InOut && !Self::bound_next_field(me) {
            return;
        }
        me.out.buf.append(&mut me.current_out);
        me.meta_offsets.clear();
    }

    /// Records where the field in `current_out` starts in `out`. `false`: with no bytes and no `""`, it is no argument.
    #[cold]
    fn bound_next_field(me: &mut Expansion) -> bool {
        if me.current_out.is_empty() && !me.has_quoted_empty {
            // `take_out` reports the `""` of a field that is alone in `out` and has no bytes.
            me.has_quoted_empty = me.out.buf.is_empty() && me.out.bounds.is_empty();
            return false;
        }
        me.out.bounds.push(me.out.buf.len() as u32);
        true
    }

    /// Adds a result of brace expansion or of a glob to `out`.
    fn push_variant(me: &mut Expansion, variant: &[u8]) {
        if me.earlier_fields == EarlierFields::InOut {
            me.out.bounds.push(me.out.buf.len() as u32);
        }
        me.out.buf.extend_from_slice(variant);
        if !me.out.buf.is_empty() {
            me.earlier_fields = EarlierFields::InOut;
        }
    }

    /// Newlines→spaces, trim, then split on whitespace runs into separate
    /// argv words.
    fn post_subshell_expansion(me: &mut Expansion, mut stdout: Vec<u8>) {
        // Strip a single trailing newline, then convert remaining newlines
        // to spaces.
        if stdout.last() == Some(&b'\n') {
            stdout.pop();
        }
        for b in stdout.iter_mut() {
            if *b == b'\n' {
                *b = b' ';
            }
        }
        // Trim leading/trailing whitespace.
        let s: &[u8] = {
            let mut lo = 0usize;
            let mut hi = stdout.len();
            while lo < hi && matches!(stdout[lo], b' ' | b'\n' | b'\r' | b'\t') {
                lo += 1;
            }
            while hi > lo && matches!(stdout[hi - 1], b' ' | b'\n' | b'\r' | b'\t') {
                hi -= 1;
            }
            &stdout[lo..hi]
        };
        if s.is_empty() {
            return;
        }
        // Split on runs of spaces — each run is a word boundary.
        let mut prev_ws = false;
        let mut a = 0usize;
        for (i, &c) in s.iter().enumerate() {
            if prev_ws {
                if c != b' ' {
                    a = i;
                    prev_ws = false;
                }
                continue;
            }
            if c == b' ' {
                prev_ws = true;
                me.current_out.extend_from_slice(&s[a..i]);
                Self::end_field(me);
            }
        }
        me.current_out.extend_from_slice(&s[a..]);
    }

    pub(crate) fn child_done(
        interp: &Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        // Child is a Script (command substitution). Its captured stdout lives
        // in the duped `ShellExecEnv` it owns; read it before deinit.
        debug_assert!(matches!(interp.node(child).kind(), StateKind::Script));
        if interp.failed() {
            // The script failed: the rest of the word is not expanded.
            {
                let me = interp.as_expansion_mut(this);
                me.state = ExpansionState::Done;
                me.child_script = None;
            }
            interp.deinit_node(child);
            let parent = interp.as_expansion(this).base.parent;
            return interp.child_done(parent, this, 1);
        }
        // SAFETY: single trampoline frame; the child script's env (and its
        // parent buffer in the `Borrowed` case) has no other live borrow.
        let mut stdout = unsafe {
            interp
                .as_script_mut(child)
                .base
                .shell_mut()
                .buffered_stdout_mut()
        }
        .clone();
        // Like bash and dash, drop NUL bytes before trimming and field splitting.
        let had_nul = bun_core::strings::contains_char(&stdout, 0);
        if had_nul {
            stdout.retain(|&b| b != 0);
        }

        // Propagate the exit code if the *whole* atom was a single `$(...)`
        // (so `$(false)` as argv0 fails the command).
        let sole_cmd_subst = matches!(
            interp.as_expansion(this).node.get(),
            ast::Atom::Simple(ast::SimpleAtom::CmdSubst(_))
        );

        let no_split = {
            let me = interp.as_expansion(this);
            me.cmd_subst_quoted
                || me.assign_ctx
                || matches!(&me.state, ExpansionState::CmdSubst(Some(words)) if words.top.one_string)
        };
        let words = {
            let me = interp.as_expansion_mut(this);
            if exit_code != 0 && sole_cmd_subst {
                me.out_exit_code = exit_code;
            }
            if no_split {
                let mut hi = stdout.len();
                while hi > 0 && matches!(stdout[hi - 1], b' ' | b'\n' | b'\r' | b'\t') {
                    hi -= 1;
                }
                me.current_out.extend_from_slice(&stdout[..hi]);
                // A quoted substitution that printed only NUL bytes expands to one empty word.
                if had_nul && me.cmd_subst_quoted {
                    me.has_quoted_empty = true;
                }
            } else {
                Self::post_subshell_expansion(me, stdout);
            }
            me.child_script = None;
            match core::mem::replace(&mut me.state, ExpansionState::Walking) {
                ExpansionState::CmdSubst(Some(words)) => Some(words),
                _ => {
                    me.word_idx += 1;
                    None
                }
            }
        };
        interp.deinit_node(child);
        match words {
            Some(mut words) => {
                words.top.idx += 1;
                Self::walk_words(interp, this, *words)
            }
            None => Yield::Next(this),
        }
    }

    /// Main-thread re-entry for the
    /// off-thread glob walker — splice each match as a separate word into
    /// `out` then resume the atom-walk trampoline.
    pub(crate) fn on_glob_walk_done(
        interp: &Interpreter,
        this: NodeId,
        result: Vec<Vec<u8>>,
        err: Option<crate::shell::dispatch_tasks::ShellGlobErr>,
    ) {
        use crate::shell::dispatch_tasks::ShellGlobErr;
        log!("Expansion {} onGlobWalkDone", this);
        let walk_err = match err {
            Some(ShellGlobErr::Syscall(e))
                if matches!(e.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR) =>
            {
                log!("Expansion {} glob walk failed: {}", this, e);
                None
            }
            other => other,
        };

        if result.is_empty() || walk_err.is_some() {
            // In variable assignments a no-match glob
            // expands to the literal pattern; otherwise it's an error.
            let parent = interp.as_expansion(this).base.parent;
            let in_assign = matches!(interp.node(parent).kind(), StateKind::Assign)
                || matches!(
                    interp.node(parent),
                    Node::Cmd(c) if matches!(
                        c.state,
                        crate::shell::states::cmd::CmdState::ExpandingAssigns
                    )
                );
            let me = interp.as_expansion_mut(this);
            if in_assign {
                Self::push_current_out(me);
                me.state = ExpansionState::Done;
            } else if let Some(err) = walk_err {
                let shell_err = match err {
                    ShellGlobErr::Syscall(e) => ShellErr::new_sys(&e),
                    ShellGlobErr::Unknown(e) => ShellErr::Custom(e.to_string().into_bytes().into()),
                };
                me.state = ExpansionState::Err(Box::new(shell_err));
            } else {
                let msg = format!(
                    "no matches found: {}",
                    bstr::BStr::new(Self::walked_field(me))
                );
                me.state = ExpansionState::Err(Box::new(ShellErr::Custom(msg.into_bytes().into())));
            }
            Yield::Next(this).run(interp);
            return;
        }

        {
            let me = interp.as_expansion_mut(this);
            // Push each match as its own argv word. The
            // walker arena owns the strings, so they were `to_vec`'d already.
            for entry in result {
                Self::push_variant(me, &entry);
            }
            if Self::has_field_end(me) {
                return Self::add_fields(interp, this, true).run(interp);
            }
            me.state = ExpansionState::Done;
        }
        Yield::Next(this).run(interp);
    }

    /// The field of the glob walk. In an atom with a [`FIELD_END`], `add_fields` left all fields in `current_out`.
    fn walked_field(me: &Expansion) -> &[u8] {
        if !Self::has_field_end(me) {
            return &me.current_out;
        }
        Fields::new(
            &me.current_out,
            &me.meta_offsets,
            me.word_idx as usize,
            false,
        )
        .next()
        .map_or(&me.current_out, |field| field.bytes)
    }

    /// Take the error out of `state == Err(_)` (called by the parent on
    /// `child_done(_, 1)` to print it). Leaves `state == Done`.
    pub(crate) fn take_err(interp: &Interpreter, this: NodeId) -> Option<ShellErr> {
        let me = interp.as_expansion_mut(this);
        match core::mem::replace(&mut me.state, ExpansionState::Done) {
            ExpansionState::Err(e) => Some(*e),
            other => {
                me.state = other;
                None
            }
        }
    }

    pub(crate) fn deinit(interp: &Interpreter, this: NodeId) {
        log!("Expansion {} deinit", this);
        let child = interp.as_expansion_mut(this).child_script.take();
        if let Some(c) = child {
            interp.deinit_node(c);
        }
        let me = interp.as_expansion_mut(this);
        me.out.buf.clear();
        me.out.bounds.clear();
        me.current_out.clear();
    }

    /// Take the expanded output (called by the parent after `child_done`).
    pub(crate) fn take_out(interp: &Interpreter, this: NodeId) -> ExpansionOut {
        let me = interp.as_expansion_mut(this);
        let mut out = core::mem::take(&mut me.out);
        out.out_exit_code = me.out_exit_code;
        out.has_quoted_empty = me.has_quoted_empty;
        out
    }
}
