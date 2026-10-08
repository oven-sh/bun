//! `glob_match` of the crate `fast-glob`, 1.1.1, which is a fork of `glob-match`: what
//! `customGroups[].elementNamePattern` is matched with.

use smallvec::SmallVec;

const MAX_BRACE_NESTING: usize = 10;

#[derive(Clone, Copy, Default)]
struct Wildcard {
    glob_index: usize,
    path_index: usize,
    brace_depth: usize,
}

#[derive(Clone, Copy, Default)]
struct State {
    path_index: usize,
    glob_index: usize,
    brace_depth: usize,
    wildcard: Wildcard,
    globstar: Wildcard,
}

/// Where a `{` is, and where the branch of it that is being tried starts.
type BraceStack = SmallVec<[(usize, usize); MAX_BRACE_NESTING]>;

/// Whether `path` matches `glob`. An invalid pattern matches nothing.
pub(super) fn glob_match(glob: &[u8], path: &[u8]) -> bool {
    let mut state = State::default();
    let negations = glob.iter().take_while(|byte| **byte == b'!').count();
    state.glob_index = negations;
    let is_negated = negations % 2 == 1;

    let (mut brace_stack, mut is_invalid) = (BraceStack::new(), false);
    let is_matched =
        state.glob_match_from(glob, path, negations, &mut brace_stack, &mut is_invalid);
    if is_invalid || (is_negated && !is_matched && !is_valid(glob)) {
        return false;
    }
    is_negated != is_matched
}

/// `validate`
fn is_valid(glob: &[u8]) -> bool {
    let mut index = glob.iter().take_while(|byte| **byte == b'!').count();
    let mut open_braces = 0usize;
    while let Some(&byte) = glob.get(index) {
        match byte {
            b'\\' if index + 1 >= glob.len() => return false,
            b'\\' => index += 2,
            b'[' => match skip_class(glob, index) {
                Some(next) => index = next,
                None => return false,
            },
            b'{' if open_braces == MAX_BRACE_NESTING => return false,
            b'{' => {
                open_braces += 1;
                index += 1;
            }
            b'}' => {
                open_braces = open_braces.saturating_sub(1);
                index += 1;
            }
            _ => index += 1,
        }
    }
    open_braces == 0
}

/// The index after the `]` that closes the character class that the `[` at `index` opens.
fn skip_class(glob: &[u8], index: usize) -> Option<usize> {
    let mut index = index + 1;
    if matches!(glob.get(index), Some(b'^' | b'!')) {
        index += 1;
    }
    let mut is_first = true;
    loop {
        match glob.get(index)? {
            b']' if !is_first => return Some(index + 1),
            b'\\' => index += 1,
            _ => {}
        }
        is_first = false;
        index += 1;
    }
}

impl State {
    /// The character at `glob_index`, which is `c`, or what it escapes. `None`: nothing.
    fn unescape(&mut self, c: u8, glob: &[u8]) -> Option<u8> {
        if c != b'\\' {
            return Some(c);
        }
        self.glob_index += 1;
        Some(match *glob.get(self.glob_index)? {
            b'b' => 0x08,
            b'n' => b'\n',
            b'r' => b'\r',
            b't' => b'\t',
            c => c,
        })
    }

    fn backtrack(&mut self) {
        self.glob_index = self.wildcard.glob_index;
        self.path_index = self.wildcard.path_index;
        self.brace_depth = self.wildcard.brace_depth;
    }

    fn skip_globstars(&mut self, glob: &[u8]) {
        let mut glob_index = self.glob_index + 2;
        while glob.get(glob_index..glob_index + 4) == Some(b"/**/") {
            glob_index += 3;
        }
        if glob.get(glob_index..) == Some(b"/**") {
            glob_index += 3;
        }
        self.glob_index = glob_index - 2;
    }

    fn skip_to_separator(&mut self, path: &[u8], is_end_invalid: bool) {
        if self.path_index == path.len() {
            self.wildcard.path_index += 1;
            return;
        }
        let rest = path.get(self.path_index..).unwrap_or_default();
        let mut path_index = self.path_index
            + bun_core::strings::index_of_char_usize(rest, b'/').unwrap_or(rest.len());
        if is_end_invalid || path_index != path.len() {
            path_index += 1;
        }
        self.wildcard.path_index = path_index;
        self.globstar = self.wildcard;
    }

    fn skip_branch(&mut self, glob: &[u8]) {
        let end_brace_depth = self.brace_depth.saturating_sub(1);
        while let Some(&byte) = glob.get(self.glob_index) {
            match byte {
                b'{' => self.brace_depth += 1,
                b'}' => {
                    self.brace_depth = self.brace_depth.saturating_sub(1);
                    if self.brace_depth == end_brace_depth {
                        self.glob_index += 1;
                        return;
                    }
                }
                b'[' => {
                    self.glob_index = skip_class(glob, self.glob_index).unwrap_or(glob.len());
                    continue;
                }
                b'\\' => self.glob_index += 1,
                _ => {}
            }
            self.glob_index += 1;
        }
    }

    fn match_brace_branch(
        &self,
        glob: &[u8],
        path: &[u8],
        open_brace_index: usize,
        branch_index: usize,
        brace_stack: &mut BraceStack,
        is_invalid: &mut bool,
    ) -> bool {
        if brace_stack.len() == MAX_BRACE_NESTING {
            *is_invalid = true;
            return false;
        }
        brace_stack.push((open_brace_index, branch_index));
        let mut branch_state = *self;
        branch_state.glob_index = branch_index;
        branch_state.brace_depth = brace_stack.len();
        let is_matched =
            branch_state.glob_match_from(glob, path, branch_index, brace_stack, is_invalid);
        brace_stack.pop();
        is_matched
    }

    fn match_brace(
        &mut self,
        glob: &[u8],
        path: &[u8],
        brace_stack: &mut BraceStack,
        is_invalid: &mut bool,
    ) -> bool {
        let (mut brace_depth, mut is_matched) = (0usize, false);
        let open_brace_index = self.glob_index;
        let mut branch_index = 0;
        while let Some(&byte) = glob.get(self.glob_index) {
            match byte {
                b'{' => {
                    brace_depth += 1;
                    if brace_depth == 1 {
                        branch_index = self.glob_index + 1;
                    }
                }
                b'}' => {
                    brace_depth = brace_depth.saturating_sub(1);
                    if brace_depth == 0 {
                        return self.match_brace_branch(
                            glob,
                            path,
                            open_brace_index,
                            branch_index,
                            brace_stack,
                            is_invalid,
                        ) || is_matched;
                    }
                }
                b',' if brace_depth == 1 => {
                    is_matched |= self.match_brace_branch(
                        glob,
                        path,
                        open_brace_index,
                        branch_index,
                        brace_stack,
                        is_invalid,
                    );
                    branch_index = self.glob_index + 1;
                }
                b'[' => {
                    self.glob_index = skip_class(glob, self.glob_index).unwrap_or(glob.len());
                    continue;
                }
                b'\\' => self.glob_index += 1,
                _ => {}
            }
            self.glob_index += 1;
        }
        *is_invalid = true;
        false
    }

    fn glob_match_from(
        &mut self,
        glob: &[u8],
        path: &[u8],
        match_start: usize,
        brace_stack: &mut BraceStack,
        is_invalid: &mut bool,
    ) -> bool {
        while self.glob_index < glob.len() || self.path_index < path.len() {
            let at_path = path.get(self.path_index).copied();
            match (glob.get(self.glob_index).copied(), at_path) {
                (Some(b'*'), _) => {
                    let is_globstar = glob.get(self.glob_index + 1) == Some(&b'*');
                    if is_globstar {
                        self.skip_globstars(glob);
                    }
                    self.wildcard = Wildcard {
                        glob_index: self.glob_index,
                        path_index: self.path_index + 1,
                        brace_depth: self.brace_depth,
                    };
                    let mut is_in_globstar = false;
                    if is_globstar {
                        self.glob_index += 2;
                        let is_end_invalid = self.glob_index != glob.len();
                        if (self.glob_index.saturating_sub(match_start) < 3
                            || glob.get(self.glob_index - 3) == Some(&b'/'))
                            && (!is_end_invalid || glob.get(self.glob_index) == Some(&b'/'))
                        {
                            if is_end_invalid {
                                self.glob_index += 1;
                            }
                            self.skip_to_separator(path, is_end_invalid);
                            is_in_globstar = true;
                        }
                    } else {
                        self.glob_index += 1;
                    }
                    if !is_in_globstar && at_path == Some(b'/') {
                        self.wildcard = self.globstar;
                    }
                    continue;
                }
                (Some(b'?'), Some(c)) if c != b'/' => {
                    self.glob_index += 1;
                    self.path_index += 1;
                    continue;
                }
                (Some(b'['), Some(c)) => {
                    self.glob_index += 1;
                    let is_negated = matches!(glob.get(self.glob_index), Some(b'^' | b'!'));
                    self.glob_index += usize::from(is_negated);
                    let (mut is_first, mut is_match) = (true, false);
                    while let Some(&low) = glob
                        .get(self.glob_index)
                        .filter(|byte| is_first || **byte != b']')
                    {
                        let Some(low) = self.unescape(low, glob) else {
                            *is_invalid = true;
                            return false;
                        };
                        self.glob_index += 1;
                        let is_range = glob.get(self.glob_index) == Some(&b'-')
                            && glob
                                .get(self.glob_index + 1)
                                .is_some_and(|byte| *byte != b']');
                        let high = match is_range {
                            true => {
                                self.glob_index += 1;
                                let Some(high) = glob
                                    .get(self.glob_index)
                                    .and_then(|high| self.unescape(*high, glob))
                                else {
                                    *is_invalid = true;
                                    return false;
                                };
                                self.glob_index += 1;
                                high
                            }
                            false => low,
                        };
                        is_match |= low <= c && c <= high;
                        is_first = false;
                    }
                    if self.glob_index >= glob.len() {
                        *is_invalid = true;
                        return false;
                    }
                    self.glob_index += 1;
                    if is_match != is_negated {
                        self.path_index += 1;
                        continue;
                    }
                }
                (Some(b'{'), _) => {
                    if let Some(&(_, branch_index)) =
                        brace_stack.iter().find(|it| it.0 == self.glob_index)
                    {
                        self.glob_index = branch_index;
                        self.brace_depth += 1;
                        continue;
                    }
                    return self.match_brace(glob, path, brace_stack, is_invalid);
                }
                (Some(b',' | b'}'), _) if self.brace_depth > 0 => {
                    self.skip_branch(glob);
                    continue;
                }
                (Some(c), Some(in_path)) => {
                    let Some(c) = self.unescape(c, glob) else {
                        *is_invalid = true;
                        return false;
                    };
                    if in_path == c {
                        self.glob_index += 1;
                        self.path_index += 1;
                        if c == b'/' {
                            self.wildcard = self.globstar;
                        }
                        continue;
                    }
                }
                _ => {}
            }
            if self.wildcard.path_index > 0 && self.wildcard.path_index <= path.len() {
                self.backtrack();
                continue;
            }
            return false;
        }
        true
    }
}
