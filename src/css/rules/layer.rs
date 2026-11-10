use core::fmt;
use core::ops::ControlFlow;

use bun_alloc::{Arena, ArenaVec, ArenaVecExt};

use crate as css;
use crate::css_rules::document::MozDocumentRule;
use crate::css_rules::media::MediaRule;
use crate::css_rules::supports::SupportsRule;
use crate::css_rules::{CssRule, CssRuleList, Location};
use crate::{PrintErr, Printer, SmallList};

/// A CSS cascade layer name. Stored as a list of segments because dot
/// notation (`a.b.c`) creates sublayers.
#[derive(Default)]
pub struct LayerName {
    // TODO: arena lifetime — segments borrow the parser arena. Thread
    // `'bump` once `CssRuleList` re-gains its arena lifetime; until then
    // segments are laundered through `&'static [u8]` like every other CSS
    // slice in this crate.
    pub v: SmallList<&'static [u8], 1>,
}

// Trait `Clone` (not just inherent `deep_clone`) so the bundler's
// `Chunk::Layers::to_owned` can `deep_clone_with(|l| l.clone())`. Segments are
// arena-borrowed `&'static [u8]` (Copy), so this is the same shallow
// `SmallList` copy as `deep_clone`.
impl Clone for LayerName {
    fn clone(&self) -> Self {
        LayerName { v: self.v.clone() }
    }
}

impl LayerName {
    pub fn eql(&self, rhs: &LayerName) -> bool {
        if self.v.len() != rhs.v.len() {
            return false;
        }
        for (l, r) in self.v.slice().iter().zip(rhs.v.slice()) {
            if **l != **r {
                return false;
            }
        }
        true
    }

    pub fn parse(input: &mut css::css_parser::Parser<'_>) -> css::css_parser::CssResult<LayerName> {
        let mut parts: SmallList<&'static [u8], 1> = SmallList::default();
        let ident = input.expect_ident()?;
        parts.append(ident);

        loop {
            let try_parse_fn =
                |i: &mut css::css_parser::Parser<'_>| -> css::css_parser::CssResult<&'static [u8]> {
                    let start_location = i.current_source_location();
                    let tok = *i.next_including_whitespace()?;
                    if !matches!(tok, css::Token::Delim(c) if c == u32::from(b'.')) {
                        return Err(start_location.new_basic_unexpected_token_error(tok));
                    }

                    let start_location = i.current_source_location();
                    let tok = *i.next_including_whitespace()?;
                    if let css::Token::Ident(ident) = tok {
                        return Ok(ident);
                    }
                    Err(start_location.new_basic_unexpected_token_error(tok))
                };

            match input.try_parse(try_parse_fn) {
                Ok(name) => parts.append(name),
                Err(_) => return Ok(LayerName { v: parts }),
            }
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        dest.write_separated(
            self.v.slice(),
            |d| d.write_char(b'.'),
            |d, name| d.serialize_identifier(name),
        )
    }

    pub(crate) fn deep_clone(&self, _bump: &Arena) -> Self {
        // Segments are arena-owned (identity copy).
        LayerName { v: self.v.clone() }
    }
}

impl css::generics::ToCss for LayerName {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        LayerName::to_css(self, dest)
    }
}

impl fmt::Display for LayerName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut first = true;
        for name in self.v.slice() {
            if first {
                first = false;
            } else {
                f.write_str(".")?;
            }
            // bytes may not be valid UTF-8; use bstr Display
            fmt::Display::fmt(bstr::BStr::new(name), f)?;
        }
        Ok(())
    }
}

/// A [@layer block](https://drafts.csswg.org/css-cascade-5/#layer-block) rule.
pub struct LayerBlockRule<R> {
    /// PERF: null pointer optimizaiton, nullable
    /// The name of the layer to declare, or `None` to declare an anonymous layer.
    pub name: Option<LayerName>,
    /// The rules within the `@layer` rule.
    pub rules: CssRuleList<R>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl<R> LayerBlockRule<R> {
    pub(crate) fn deep_clone<'bump>(&self, bump: &'bump Arena) -> Self
    where
        R: css::generics::DeepClone<'bump>,
    {
        // `css.implementDeepClone` field-walk.
        Self {
            name: self.name.as_ref().map(|n| n.deep_clone(bump)),
            rules: self.rules.deep_clone(bump),
            loc: self.loc,
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        dest.write_str("@layer")?;
        if let Some(name) = &self.name {
            dest.write_char(b' ')?;
            name.to_css(dest)?;
        }

        dest.block(|d| {
            d.newline()?;
            self.rules.to_css(d)
        })
    }
}

/// A [@layer statement](https://drafts.csswg.org/css-cascade-5/#layer-empty) rule.
///
/// See also [LayerBlockRule](LayerBlockRule).
pub struct LayerStatementRule {
    /// The layer names to declare.
    pub names: SmallList<LayerName, 1>,
    /// The location of the rule in the source file.
    pub loc: Location,
}

impl LayerStatementRule {
    pub(crate) fn deep_clone(&self, bump: &Arena) -> Self {
        // `css.implementDeepClone` field-walk.
        let mut names = SmallList::<LayerName, 1>::default();
        for n in self.names.slice() {
            names.append(n.deep_clone(bump));
        }
        Self {
            names,
            loc: self.loc,
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);
        if self.names.len() > 0 {
            dest.write_str("@layer ")?;
            css::to_css::from_list(self.names.slice(), dest)?;
            dest.write_char(b';')
        } else {
            dest.write_str("@layer;")
        }
    }
}

/// The names of the `@layer` blocks around a rule.
type LayerPath = SmallList<&'static [u8], 8>;

/// The top-level rules that `prepare_css_asts_for_chunk` prints for a copy of a style sheet.
fn printed_rules<R>(
    rules: &[CssRule<R>],
    has_layers_pre_import: bool,
) -> impl Iterator<Item = &CssRule<R>> {
    let mut keep_statements = !has_layers_pre_import;
    let mut in_prologue = true;
    rules.iter().filter(move |rule| {
        if in_prologue {
            match rule {
                CssRule::Import(_) => {
                    keep_statements = true;
                    return false;
                }
                CssRule::Ignored => return false,
                CssRule::LayerStatement(_) => return keep_statements,
                _ => in_prologue = false,
            }
        }
        !matches!(rule, CssRule::Import(_))
    })
}

/// Whether `expected` is `name` inside the layers of `path`.
fn is_name_in_path(expected: &LayerName, path: &LayerPath, name: &LayerName) -> bool {
    let (expected, path, name) = (expected.v.slice(), path.slice(), name.v.slice());
    expected.len() == path.len() + name.len()
        && expected[..path.len()] == *path
        && expected[path.len()..] == *name
}

/// Calls `visit(layers around it, name, is under a condition)` for each `@layer` name, in order.
struct LayerNameWalk<'f> {
    path: LayerPath,
    conditions: u32,
    visit: &'f mut dyn FnMut(&LayerPath, Option<&LayerName>, bool) -> ControlFlow<()>,
}

impl LayerNameWalk<'_> {
    fn rules<'r, R: 'r>(
        &mut self,
        rules: impl IntoIterator<Item = &'r CssRule<R>>,
    ) -> ControlFlow<()> {
        for rule in rules {
            self.rule(rule)?;
        }
        ControlFlow::Continue(())
    }

    fn conditional<R>(&mut self, rules: &CssRuleList<R>) -> ControlFlow<()> {
        self.conditions += 1;
        let flow = self.rules(&rules.v);
        self.conditions -= 1;
        flow
    }

    fn rule<R>(&mut self, rule: &CssRule<R>) -> ControlFlow<()> {
        match rule {
            CssRule::LayerStatement(statement) => {
                for name in statement.names.slice() {
                    (self.visit)(&self.path, Some(name), self.conditions != 0)?;
                }
                ControlFlow::Continue(())
            }
            CssRule::LayerBlock(block) => {
                // No other rule can name a layer inside an anonymous one.
                let Some(name) = &block.name else {
                    return (self.visit)(&self.path, None, self.conditions != 0);
                };
                (self.visit)(&self.path, Some(name), self.conditions != 0)?;
                let depth = self.path.len();
                self.path.append_slice(name.v.slice());
                let flow = self.rules(&block.rules.v);
                self.path.set_len(depth);
                flow
            }
            CssRule::Media(media) if media.query.always_matches() => self.rules(&media.rules.v),
            CssRule::Media(media) => self.conditional(&media.rules),
            CssRule::Supports(supports) => self.conditional(&supports.rules),
            CssRule::MozDocument(document) => self.conditional(&document.rules),
            // A layer inside one of these rules is declared also where the rule does not apply.
            CssRule::Style(style) => self.rules(&style.rules.v),
            CssRule::Nesting(nesting) => self.rules(&nesting.style.rules.v),
            CssRule::Container(container) => self.rules(&container.rules.v),
            CssRule::Scope(scope) => self.rules(&scope.rules.v),
            CssRule::StartingStyle(starting_style) => self.rules(&starting_style.rules.v),
            CssRule::Import(_)
            | CssRule::Keyframes(_)
            | CssRule::FontFace(_)
            | CssRule::FontPaletteValues(_)
            | CssRule::Page(_)
            | CssRule::CounterStyle(_)
            | CssRule::Namespace(_)
            | CssRule::NestedDeclarations(_)
            | CssRule::Viewport(_)
            | CssRule::CustomMedia(_)
            | CssRule::Property(_)
            | CssRule::Ignored
            | CssRule::Unknown(_)
            | CssRule::Custom(_) => ControlFlow::Continue(()),
        }
    }
}

impl<R> CssRuleList<R> {
    /// A list in the arena of `rules`. It must not be dropped or grown: the arena frees it.
    pub fn from_arena(rules: ArenaVec<'_, CssRule<R>>) -> Self {
        let len = rules.len();
        if len == 0 {
            return Self::default();
        }
        let slab = rules.into_bump_slice_mut();
        Self {
            // SAFETY: `slab` is arena-owned; the `Vec` is never dropped or grown (see fn doc).
            v: unsafe { Vec::from_raw_parts(slab.as_mut_ptr(), len, len) },
        }
    }

    /// Whether the top-level `@layer` rules name exactly `names`, all names of the sheet, in order.
    pub fn top_level_layers_are(&self, names: &[LayerName], has_layers_pre_import: bool) -> bool {
        let mut expected = names.iter();
        let mut is_next = |name: &LayerName| expected.next().is_some_and(|next| next.eql(name));
        for rule in printed_rules(&self.v, has_layers_pre_import) {
            match rule {
                CssRule::LayerStatement(statement) => {
                    if !statement.names.slice().iter().all(&mut is_next) {
                        return false;
                    }
                }
                CssRule::LayerBlock(block) => {
                    if let Some(name) = &block.name
                        && !is_next(name)
                    {
                        return false;
                    }
                }
                _ => {}
            }
        }
        expected.next().is_none()
    }

    /// Whether a rule, at any depth, is an `@layer` block with no name.
    #[cold]
    pub fn has_anonymous_layer(&self) -> bool {
        let mut walk = LayerNameWalk {
            path: LayerPath::default(),
            conditions: 0,
            visit: &mut |_: &LayerPath, name: Option<&LayerName>, _: bool| match name {
                Some(_) => ControlFlow::Continue(()),
                None => ControlFlow::Break(()),
            },
        };
        walk.rules(&self.v).is_break()
    }

    /// Whether one `@layer` statement of `names` orders the layers as these rules do in every case.
    #[cold]
    pub fn layers_are_in_order_of(
        &self,
        names: &[LayerName],
        layers_pre_import: &[LayerName],
    ) -> bool {
        let has_layers_pre_import = !layers_pre_import.is_empty();

        // Nothing is inside a condition, and the rules have the names one by one.
        let mut found = 0;
        let mut walk = LayerNameWalk {
            path: LayerPath::default(),
            conditions: 0,
            visit: &mut |path: &LayerPath, name: Option<&LayerName>, conditional: bool| {
                let Some(name) = name else {
                    return ControlFlow::Continue(());
                };
                let expected = names.get(found).filter(|_| !conditional);
                if !expected.is_some_and(|expected| is_name_in_path(expected, path, name)) {
                    return ControlFlow::Break(());
                }
                found += 1;
                ControlFlow::Continue(())
            },
        };
        if walk
            .rules(printed_rules(&self.v, has_layers_pre_import))
            .is_continue()
            && found == names.len()
        {
            return true;
        }

        // A trie of the layers, because the name `a.b` also declares `a`. Node 0 is no layer.
        const DECLARED: u32 = u32::MAX;
        let mut children: bun_collections::HashMap<(u32, &[u8]), u32> =
            bun_collections::HashMap::new();
        // The place of each node among the layers that `names` declare first, or `DECLARED`.
        let mut place: Vec<u32> = vec![DECLARED];
        let mut count = 0;
        for (list, is_declared) in [(layers_pre_import, true), (names, false)] {
            for name in list {
                let mut node = 0;
                for segment in name.v.slice() {
                    let child = bun_core::handle_oom(children.get_or_put((node, *segment)));
                    if !child.found_existing {
                        *child.value_ptr = place.len() as u32;
                        place.push(if is_declared {
                            DECLARED
                        } else {
                            count += 1;
                            count - 1
                        });
                    }
                    node = *child.value_ptr;
                }
            }
        }

        // The statement declares each layer with no condition, in the order of `place`.
        let mut reached = 0;
        let mut walk = LayerNameWalk {
            path: LayerPath::default(),
            conditions: 0,
            visit: &mut |path: &LayerPath, name: Option<&LayerName>, conditional: bool| {
                let Some(name) = name else {
                    return ControlFlow::Continue(());
                };
                let mut node = 0;
                for segment in path.slice().iter().chain(name.v.slice()) {
                    let Some(&child) = children.get(&(node, *segment)) else {
                        return ControlFlow::Break(());
                    };
                    node = child;
                    let layer = &mut place[node as usize];
                    if *layer == DECLARED {
                        continue;
                    }
                    if conditional || *layer != reached {
                        return ControlFlow::Break(());
                    }
                    *layer = DECLARED;
                    reached += 1;
                }
                ControlFlow::Continue(())
            },
        };
        walk.rules(printed_rules(&self.v, has_layers_pre_import))
            .is_continue()
            && reached == count
    }

    /// The `@layer` names of these rules, inside copies of the conditions around them. The caller never drops the result, which aliases `self` and lives in `bump`.
    pub unsafe fn layer_skeleton(&self, has_layers_pre_import: bool, bump: &Arena) -> Self {
        let mut builder = LayerSkeleton {
            bump,
            path: LayerPath::default(),
        };
        let mut level = SkeletonLevel::new(bump);
        builder.rules(printed_rules(&self.v, has_layers_pre_import), &mut level);
        level.finish(bump)
    }
}

/// The skeleton of the rules in one block.
struct SkeletonLevel<'bump, R> {
    rules: ArenaVec<'bump, CssRule<R>>,
    /// The names since the last rule of `rules`. They make one statement.
    names: Vec<LayerName>,
}

impl<'bump, R> SkeletonLevel<'bump, R> {
    fn new(bump: &'bump Arena) -> Self {
        Self {
            rules: ArenaVec::new_in(bump),
            names: Vec::new(),
        }
    }

    fn flush_names(&mut self, bump: &'bump Arena) {
        if self.names.is_empty() {
            return;
        }
        self.rules.push(CssRule::LayerStatement(LayerStatementRule {
            names: SmallList::from_arena_iter(bump, self.names.drain(..)),
            loc: Location::dummy(),
        }));
    }

    fn finish(mut self, bump: &'bump Arena) -> CssRuleList<R> {
        self.flush_names(bump);
        CssRuleList::from_arena(self.rules)
    }
}

struct LayerSkeleton<'bump> {
    bump: &'bump Arena,
    path: LayerPath,
}

impl<'bump> LayerSkeleton<'bump> {
    fn name(&self, name: &LayerName) -> LayerName {
        let mut segments = self.path.clone();
        segments.append_slice(name.v.slice());
        LayerName {
            v: SmallList::from_arena_iter(self.bump, segments),
        }
    }

    fn rules<'r, R: 'r>(
        &mut self,
        rules: impl IntoIterator<Item = &'r CssRule<R>>,
        level: &mut SkeletonLevel<'bump, R>,
    ) {
        for rule in rules {
            self.rule(rule, level);
        }
    }

    /// The rules of a block whose rule is a condition. `copy` makes that rule around their skeleton.
    fn conditional<R>(
        &mut self,
        rules: &CssRuleList<R>,
        level: &mut SkeletonLevel<'bump, R>,
        copy: impl FnOnce(CssRuleList<R>) -> CssRule<R>,
    ) {
        let mut inside = SkeletonLevel::new(self.bump);
        self.rules(&rules.v, &mut inside);
        let inside = inside.finish(self.bump);
        if !inside.v.is_empty() {
            level.flush_names(self.bump);
            level.rules.push(copy(inside));
        }
    }

    fn rule<R>(&mut self, rule: &CssRule<R>, level: &mut SkeletonLevel<'bump, R>) {
        let loc = Location::dummy();
        match rule {
            CssRule::LayerStatement(statement) => {
                for name in statement.names.slice() {
                    level.names.push(self.name(name));
                }
            }
            CssRule::LayerBlock(block) => {
                let Some(name) = &block.name else { return };
                level.names.push(self.name(name));
                let depth = self.path.len();
                self.path.append_slice(name.v.slice());
                self.rules(&block.rules.v, level);
                self.path.set_len(depth);
            }
            CssRule::Media(media) if media.query.always_matches() => {
                self.rules(&media.rules.v, level)
            }
            // The names in it are never in the layer order.
            CssRule::Media(media) if media.query.never_matches() => {}
            CssRule::Media(media) => self.conditional(&media.rules, level, |rules| {
                CssRule::Media(MediaRule {
                    // SAFETY: a bitwise copy that is never dropped (see `layer_skeleton`).
                    query: unsafe { core::ptr::read(&raw const media.query) },
                    rules,
                    loc,
                })
            }),
            CssRule::Supports(supports) => self.conditional(&supports.rules, level, |rules| {
                CssRule::Supports(SupportsRule {
                    // SAFETY: a bitwise copy that is never dropped (see `layer_skeleton`).
                    condition: unsafe { core::ptr::read(&raw const supports.condition) },
                    rules,
                    loc,
                })
            }),
            CssRule::MozDocument(document) => self.conditional(&document.rules, level, |rules| {
                CssRule::MozDocument(MozDocumentRule { rules, loc })
            }),
            CssRule::Style(style) => self.rules(&style.rules.v, level),
            CssRule::Nesting(nesting) => self.rules(&nesting.style.rules.v, level),
            CssRule::Container(container) => self.rules(&container.rules.v, level),
            CssRule::Scope(scope) => self.rules(&scope.rules.v, level),
            CssRule::StartingStyle(starting_style) => self.rules(&starting_style.rules.v, level),
            CssRule::Import(_)
            | CssRule::Keyframes(_)
            | CssRule::FontFace(_)
            | CssRule::FontPaletteValues(_)
            | CssRule::Page(_)
            | CssRule::CounterStyle(_)
            | CssRule::Namespace(_)
            | CssRule::NestedDeclarations(_)
            | CssRule::Viewport(_)
            | CssRule::CustomMedia(_)
            | CssRule::Property(_)
            | CssRule::Ignored
            | CssRule::Unknown(_)
            | CssRule::Custom(_) => {}
        }
    }
}
