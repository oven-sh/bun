//! What oxlint says besides the message of a diagnostic: its `help`, its `note`, and what it says at the place.
//!
//! Made from what oxlint 1.87 prints for the cases of the test suites, each paired with what `bun lint` reports at the same place: an
//! entry is the text of oxlint in which the values that the rule gives to [`Report::data`](crate::context::Report::data) are
//! replaced by their names, if that makes the text of all the pairs with that message, letter for letter.
//!
//! The texts are in `oxlint_help.txt`, one per line, where `\n` stands for a newline and `\\` for a backslash. The table here
//! refers to them by line number, counted from 1 as editors do. Release builds embed the file compressed and inflate it the
//! first time a text is needed, which is when a problem that has one is printed.

use self::Edits::{All, First};
use self::Texts::{One, Three};
use crate::rule::{Message, Meta};
use bun_core::strings;
use std::borrow::Cow;
use std::num::NonZeroU32;

/// What the table has for a message.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct Help(NonZeroU32);

/// Which text of a diagnostic.
#[derive(Copy, Clone)]
pub(crate) enum Part {
    Help,
    /// What is said at the place of the report.
    FirstLabel,
    Note,
}

#[derive(Copy, Clone)]
pub(crate) enum Found {
    Nothing,
    Constant(&'static str),
    /// With `{{names}}`.
    WithData(&'static str),
    /// oxlint has no help of its own, and says what its `RuleFixer` says about the fix. `removes`: of a replacement by nothing that
    /// is "Remove `..`.", and not "Delete this code.".
    OfTheFix {
        removes: bool,
        edits: Edits,
    },
}

/// Of which edits of a fix oxlint speaks.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Edits {
    /// Its fix has several too, and it says what it says about the first.
    First,
    /// It makes one, which does what all of them do.
    All,
}

impl Help {
    fn entry(self) -> Option<&'static (u32, Texts, u8)> {
        INDEX.get(self.0.get() as usize - 1)
    }

    pub(crate) fn found(self, part: Part) -> Found {
        let Some(&(_, texts, with_values)) = self.entry() else {
            return Found::Nothing;
        };
        let line = match (texts, part) {
            (Texts::OfTheFix { removes, edits, .. }, Part::Help) => {
                return Found::OfTheFix { removes, edits };
            }
            (One(line), Part::Help) | (Texts::OfTheFix { note: line, .. }, Part::Note) => line,
            (Three(first), part) => first + part as u16,
            _ => 0,
        };
        let text = text_at(line);
        match text.is_empty() {
            true => Found::Nothing,
            false if with_values >> (part as u8) & 1 != 0 => Found::WithData(text),
            false => Found::Constant(text),
        }
    }

    /// The text, if it is one without values. Else "".
    pub(crate) fn constant(self, part: Part) -> &'static str {
        match self.found(part) {
            Found::Constant(text) => text,
            _ => "",
        }
    }

    /// One of the texts has values in it.
    pub(crate) fn has_values(self) -> bool {
        self.entry().is_some_and(|it| it.2 != 0)
    }

    /// The help is [`Found::OfTheFix`].
    pub(crate) fn is_of_the_fix(self) -> bool {
        matches!(self.entry(), Some((_, Texts::OfTheFix { .. }, _)))
    }
}

/// What there is for `message`, which is as oxlint says it, of `rule`.
pub(crate) fn of(rule: &Meta, message: Message) -> Option<Help> {
    let key = rule.key ^ message.key.rotate_left(16);
    let at = INDEX.binary_search_by_key(&key, |it| it.0).ok()?;
    NonZeroU32::new(at as u32 + 1).map(Help)
}

/// Line `line` of `oxlint_help.txt`. "" for 0, which stands for no text.
fn text_at(line: u16) -> &'static str {
    static LINES: bun_core::Once<Vec<Cow<'static, [u8]>>> = bun_core::Once::new();
    let Some(at) = line.checked_sub(1) else {
        return "";
    };
    let lines = LINES.get_or_init(|| {
        let text = bun_zstd::embed_compressed!(
            "src/lint/oxlint_help.txt",
            include_bytes!("oxlint_help.txt")
        );
        strings::split(text, b"\n").map(unescaped).collect()
    });
    let text = lines.get(at as usize).map_or(&b""[..], |it| &**it);
    std::str::from_utf8(text).unwrap_or_default()
}

fn unescaped(mut line: &'static [u8]) -> Cow<'static, [u8]> {
    if !strings::contains_char(line, b'\\') {
        return Cow::Borrowed(line);
    }
    let mut text = Vec::with_capacity(line.len());
    while let Some((before, [escaped, after @ ..])) = strings::split_once_char(line, b'\\') {
        text.extend_from_slice(before);
        text.push(if *escaped == b'n' { b'\n' } else { *escaped });
        line = after;
    }
    text.extend_from_slice(line);
    Cow::Owned(text)
}

/// The numbers are lines of `oxlint_help.txt`.
#[derive(Copy, Clone)]
enum Texts {
    /// The help.
    One(u16),
    /// The help, what is said at the place of the report and the note, on three lines from this one on. An empty line: there is none.
    Three(u16),
    /// [`Found::OfTheFix`], and the note. 0: there is none.
    OfTheFix {
        removes: bool,
        edits: Edits,
        note: u16,
    },
}

const fn of_the_fix(removes: bool, edits: Edits, note: u16) -> Texts {
    Texts::OfTheFix {
        removes,
        edits,
        note,
    }
}

/// Sorted by the key, which is made of `Meta::key` and `Message::key`. The last number has a bit for each [`Part`] whose text has
/// `{{` in it.
#[rustfmt::skip]
static INDEX: &[(u32, Texts, u8)] = &[
    (0x0060F26E, One(645), 0), // no-unsafe-function-type bannedFunctionType
    (0x00794F6C, of_the_fix(false, First, 0), 0), // prefer-to-be-falsy
    (0x0080189E, One(167), 0), // func-name-matching matchProperty
    (0x009D1FB0, One(664), 0), // no-useless-computed-key unnecessarilyComputedProperty
    (0x00B328BB, Three(711), 0), // prefer-at
    (0x00D239E9, One(295), 0), // no-commonjs
    (0x00F6B325, Three(418), 2), // no-func-assign isAFunction
    (0x0118BF96, Three(375), 0), // no-dynamic-delete dynamicDelete
    (0x0123C577, Three(119), 0), // default-case-last notLast
    (0x01B12D02, One(699), 1), // padding-around-test-blocks
    (0x01D7F018, One(243), 0), // next-script-for-ga
    (0x01DC3163, One(583), 1), // no-shadow-restricted-names shadowingRestrictedName
    (0x02275BCC, One(582), 1), // no-shadow noShadowGlobal
    (0x02FE0566, One(129), 0), // error-message
    (0x040964C8, One(875), 0), // unicode-bom expected
    (0x053BAE70, One(443), 0), // no-implied-eval noImpliedEvalError
    (0x058AAB56, One(813), 0), // prefer-template unexpectedStringConcatenation
    (0x05C2ED19, One(396), 0), // no-extend-native unexpected
    (0x061995FF, One(640), 0), // no-unsafe-assignment anyAssignmentThis
    (0x0687884C, One(433), 0), // no-immediate-mutation
    (0x06EAECE6, One(299), 0), // no-conditional-in-test
    (0x071D498B, One(546), 0), // no-promise-in-callback
    (0x07C91B4B, One(447), 0), // no-importing-vitest-globals
    (0x07D3DAF0, One(330), 0), // no-control-regex unexpected
    (0x0811C395, One(492), 0), // no-misused-spread noMapSpreadInObject
    (0x0858A4B1, One(611), 0), // no-unassigned-import
    (0x0872DEF5, One(73), 0), // consistent-existence-index-check
    (0x08A9ECAE, One(681), 0), // no-useless-undefined
    (0x08D1BD39, One(1), 0), // accessor-pairs missingGetterInPropertyDescriptor
    (0x0905D05C, One(571), 0), // no-self-assign selfAssignment
    (0x091A0342, One(738), 0), // prefer-dom-node-text-content
    (0x092B0E10, One(700), 0), // parameter-properties preferClassProperty
    (0x0947BAC4, One(533), 0), // no-nonoctal-decimal-escape decimalEscape
    (0x09DA5F90, One(854), 1), // restrict-plus-operands mismatched
    (0x0A513778, Three(254), 0), // no-anonymous-default-export
    (0x0AAD4A16, of_the_fix(false, First, 0), 0), // sort-keys sortKeys
    (0x0AB65693, One(543), 0), // no-process-env
    (0x0B3AFDA4, of_the_fix(false, First, 0), 0), // prefer-string-starts-ends-with
    (0x0B4075BA, One(407), 0), // no-fallthrough default
    (0x0BA721AE, One(167), 0), // func-name-matching matchVariable
    (0x0BD4ACB3, One(82), 1), // consistent-type-assertions angle-bracket
    (0x0C0D2A86, One(717), 0), // prefer-bigint-literals
    (0x0C2B5AB6, One(230), 1), // misrefactored-assign-op
    (0x0C79C256, One(211), 0), // jsx-no-target-blank
    (0x0C91E0A2, One(876), 0), // unicode-bom unexpected
    (0x0CAEE6D8, One(574), 0), // no-sequences unexpectedCommaExpression
    (0x0CC03201, Three(741), 1), // prefer-enum-initializers defineInitializer
    (0x0CFAB60A, of_the_fix(false, First, 0), 0), // prefer-includes
    (0x0D14EA50, One(205), 0), // jsx-no-duplicate-props
    (0x0D7DC07F, One(199), 0), // jsx-fragments
    (0x0D8D8E11, One(823), 0), // promise-function-async missingAsyncHybridReturn
    (0x0E05869C, One(887), 0), // use-isnan switchNaN
    (0x0E386427, One(389), 0), // no-eval unexpected
    (0x0E538FD3, One(460), 1), // no-jasmine-globals
    (0x0E83665F, One(214), 0), // label-has-associated-control
    (0x0E927D39, One(407), 0), // no-fallthrough case
    (0x0F38A7FF, One(397), 0), // no-extra-bind unexpected
    (0x0F58F8C1, One(640), 0), // no-unsafe-call unsafeCallThis
    (0x0FD049B8, One(510), 0), // no-nested-ternary noNestedTernary
    (0x0FF43A4D, One(556), 0), // no-relative-parent-imports
    (0x10142F89, One(821), 0), // preserve-caught-error partiallyLostError
    (0x101D918F, Three(288), 2), // no-class-assign class
    (0x105BB692, One(335), 0), // no-default-export
    (0x106D3C17, One(149), 0), // explicit-member-accessibility unwantedPublicAccessibility
    (0x108B4503, One(440), 0), // no-implicit-globals globalVariableLeak
    (0x10EC629D, of_the_fix(false, First, 0), 0), // prefer-to-be
    (0x10FCE172, Three(761), 0), // prefer-function-component
    (0x1140A6BB, One(748), 0), // prefer-expect-assertions
    (0x116D0C7B, of_the_fix(false, First, 0), 0), // prefer-to-be
    (0x11DDDB46, One(459), 0), // no-iterator noIterator
    (0x1237F276, One(6), 0), // alt-text
    (0x12425C48, One(123), 0), // display-name
    (0x124AB7BF, One(177), 0), // grouped-accessor-pairs notGrouped
    (0x12D67E80, of_the_fix(false, First, 0), 0), // prefer-string-slice
    (0x131E6446, One(7), 0), // alt-text
    (0x1331A7D3, One(675), 0), // no-useless-promise-resolve-reject
    (0x13B134F0, Three(111), 0), // constructor-super duplicate
    (0x144B9C52, One(1), 0), // accessor-pairs missingGetterInClass
    (0x144D600D, of_the_fix(false, First, 0), 0), // prefer-to-be-truthy
    (0x1481816A, One(103), 1), // const-comparisons
    (0x14BA2452, One(444), 0), // no-import-assign readonlyMember
    (0x14C236C5, One(702), 0), // prefer-add-event-listener
    (0x153734AE, One(173), 0), // google-font-display
    (0x155E8E4F, One(841), 0), // require-test-timeout
    (0x1582E15B, One(425), 0), // no-head-import-in-document
    (0x15F11F3B, One(151), 0), // explicit-module-boundary-types missingArgTypeUnnamed
    (0x1600E77C, One(660), 0), // no-useless-backreference backward
    (0x162E6ADB, One(158), 0), // exports-style
    (0x16A58B57, One(245), 0), // no-abusive-eslint-disable
    (0x16C210C0, One(222), 0), // max-statements exceed
    (0x16FCD447, One(212), 0), // jsx-no-target-blank
    (0x1716694C, One(715), 0), // prefer-await-to-callbacks
    (0x17DA8860, One(451), 0), // no-instanceof-array
    (0x18610854, of_the_fix(false, First, 0), 0), // prefer-to-contain
    (0x187F550D, of_the_fix(false, All, 0), 0), // array-type errorStringGeneric
    (0x18A66ABB, One(545), 0), // no-promise-executor-return returnsValue
    (0x1905F47D, One(640), 0), // no-unsafe-call errorCallThis
    (0x193E14CD, Three(254), 0), // no-anonymous-default-export
    (0x193FD901, One(8), 0), // alt-text
    (0x19959635, One(438), 0), // no-implicit-globals globalLexicalBinding
    (0x19B15CBB, One(263), 0), // no-array-reduce
    (0x1A128CDC, One(511), 0), // no-nesting
    (0x1A840B64, One(467), 0), // no-lone-blocks redundantNestedBlock
    (0x1A9B3FED, One(514), 0), // no-new-buffer
    (0x1A9EEA9F, One(586), 0), // no-standalone-expect
    (0x1AB19EE9, One(696), 0), // numeric-separators-style
    (0x1AB2D2B4, One(613), 1), // no-undef undef
    (0x1B0CC963, Three(785), 0), // prefer-namespace-keyword useNamespace
    (0x1B3387A4, One(337), 0), // no-did-mount-set-state
    (0x1B56DF94, One(652), 0), // no-unused-expressions unusedExpression
    (0x1BB099A0, One(698), 0), // padding-around-after-all-blocks
    (0x1BD891E7, One(500), 1), // no-named-as-default
    (0x1C50F8CB, One(167), 0), // func-name-matching notMatchVariable
    (0x1CB82C2D, One(24), 0), // arrow-body-style unexpectedObjectBlock
    (0x1D322BFB, One(820), 0), // prefer-type-error
    (0x1D83871A, One(456), 0), // no-invalid-void-type invalidVoidNotReturnOrThisParam
    (0x1E244682, Three(745), 0), // prefer-event-target
    (0x1E4D2974, One(598), 0), // no-thenable
    (0x1EEBBE80, One(718), 0), // prefer-called-exactly-once-with
    (0x1F7FDA40, One(330), 0), // no-control-regex unexpected
    (0x1F90CE4A, One(274), 0), // no-await-expression-member
    (0x1FAC619A, One(417), 0), // no-for-in-array forInViolation
    (0x20D05EE5, One(777), 0), // prefer-literal-enum-member notLiteral
    (0x21748555, One(758), 0), // prefer-exponentiation-operator useExponentiation
    (0x2181B206, Three(883), 0), // unified-signatures singleParameterDifference
    (0x2205CF93, One(888), 0), // use-isnan comparisonWithNaN
    (0x226B3AAC, One(512), 0), // no-new noNewStatement
    (0x22B2BA85, One(386), 0), // no-empty-object-type noEmptyInterfaceWithSuper
    (0x24487926, One(832), 1), // require-awaited-expect-poll
    (0x244A0CCB, One(628), 0), // no-unnecessary-array-splice-count
    (0x2481EB1F, One(801), 0), // prefer-rest-params preferRestParams
    (0x24E68FCA, of_the_fix(false, First, 0), 0), // prefer-to-be
    (0x250F790D, One(81), 1), // consistent-test-it
    (0x25AAA242, One(660), 0), // no-useless-backreference nested
    (0x25ADCBD5, One(178), 0), // guard-for-in wrap
    (0x25AF89B7, One(513), 0), // no-new-array
    (0x25B6FA93, Three(269), 0), // no-async-endpoint-handlers
    (0x25EE7DEF, One(643), 0), // no-unsafe-enum-comparison mismatchedCondition
    (0x2602EF24, One(567), 0), // no-return-wrap
    (0x266406B4, of_the_fix(false, First, 0), 0), // text-encoding-identifier-case
    (0x2692F915, One(212), 0), // jsx-no-target-blank
    (0x26B202C5, One(343), 0), // no-div-regex unexpected
    (0x26F06D05, One(282), 0), // no-before-interactive-script-outside-document
    (0x26FFE9DE, One(58), 0), // branches-sharing-code
    (0x279AAA40, One(132), 0), // exhaustive-deps
    (0x27F9437A, One(58), 0), // branches-sharing-code
    (0x28285BAA, Three(277), 1), // no-barrel-file
    (0x287E3094, One(247), 1), // no-accessor-recursion
    (0x28AF844A, One(167), 0), // func-name-matching notMatchProperty
    (0x28B8D6A6, One(518), 1), // no-new-native-nonconstructor noNewNonconstructor
    (0x28EF0ABD, One(869), 0), // symbol-description expected
    (0x28F15987, of_the_fix(false, First, 0), 0), // prefer-to-be
    (0x2905BD12, One(163), 0), // first
    (0x2936D5DD, One(444), 0), // no-import-assign readonly
    (0x294AC64D, One(601), 0), // no-this-assignment
    (0x29E0C363, One(760), 0), // prefer-for-of preferForOf
    (0x2A0567C6, One(434), 1), // no-immediate-mutation
    (0x2A383EE8, One(31), 1), // bad-array-method-on-arguments
    (0x2A40F8AD, One(104), 1), // const-comparisons
    (0x2A64055F, Three(348), 2), // no-dupe-class-members unexpected
    (0x2AB32820, One(11), 1), // anchor-ambiguous-text
    (0x2B1406AF, Three(365), 0), // no-duplicate-imports export
    (0x2B87867E, Three(877), 0), // unified-signatures allParametersAreSame
    (0x2C48190F, of_the_fix(false, First, 0), 0), // no-useless-escape unnecessaryEscape
    (0x2D0C060F, One(193), 0), // interactive-supports-focus
    (0x2D97980B, One(842), 0), // require-test-timeout
    (0x2D97C338, One(27), 0), // await-thenable await
    (0x2DB8429D, One(749), 0), // prefer-expect-assertions
    (0x2E0DDD90, One(210), 0), // jsx-no-script-url
    (0x2EC5DBD1, Three(89), 0), // consistent-type-assertions unexpectedObjectTypeAssertion
    (0x2F10E46A, One(191), 0), // init-declarations notInitialized
    (0x2F2BBEA6, One(688), 0), // no-with unexpectedWith
    (0x2F4F170A, One(300), 0), // no-conditional-tests
    (0x2F8E0659, One(67), 0), // class-literal-property-style preferGetterStyle
    (0x2FD0D405, One(856), 1), // role-supports-aria-props
    (0x302217C2, of_the_fix(false, First, 0), 0), // prefer-to-be
    (0x305AA56F, One(781), 1), // prefer-mock-return-shorthand
    (0x30A935DC, One(80), 1), // consistent-test-filename
    (0x30DA2BE4, One(25), 1), // autocomplete-valid
    (0x30F77694, One(222), 0), // max-lines-per-function exceed
    (0x31064F33, One(895), 0), // valid-expect
    (0x313E1D6C, One(268), 0), // no-async-client-component
    (0x31815129, One(320), 0), // no-const-enum
    (0x323049FB, One(641), 0), // no-unsafe-declaration-merging unsafeMerging
    (0x32F34167, One(789), 1), // prefer-node-protocol
    (0x331EE56D, One(22), 0), // arrow-body-style expectedBlock
    (0x338A21D2, of_the_fix(false, First, 0), 0), // prefer-to-have-length
    (0x33ADF728, One(802), 0), // prefer-set-has
    (0x345D4F08, One(122), 0), // default-param-last shouldBeLast
    (0x3491E50F, One(29), 0), // await-thenable forAwaitOfNonAsyncIterable
    (0x35A40854, One(384), 0), // no-empty-interface noEmpty
    (0x367988B3, One(336), 0), // no-delete-var unexpected
    (0x372F35A2, One(714), 0), // prefer-at
    (0x37356D1D, One(807), 0), // prefer-spread preferSpread
    (0x37359BE4, One(733), 1), // prefer-destructuring preferDestructuring
    (0x37A179DC, One(838), 0), // require-number-to-fixed-digits-argument
    (0x38375F1D, Three(549), 0), // no-react-children
    (0x38AA9EA3, One(827), 0), // react-in-jsx-scope
    (0x38F375BE, One(180), 0), // heading-has-content
    (0x39372F2F, One(1), 0), // accessor-pairs missingGetterInObjectLiteral
    (0x39763B2A, One(127), 1), // eqeqeq unexpected
    (0x39B8CC08, One(707), 0), // prefer-array-index-of
    (0x39DAC322, One(890), 0), // valid-describe-callback
    (0x3A0B6013, One(126), 0), // empty-brace-spaces
    (0x3A63C3F6, One(168), 0), // func-names named
    (0x3A6CD864, One(272), 0), // no-async-promise-executor async
    (0x3A9AE125, One(562), 1), // no-restricted-imports patternAndImportNameWithCustomMessage
    (0x3B71AA53, One(690), 1), // no-zero-fractions
    (0x3BC6501C, One(133), 0), // exhaustive-deps
    (0x3C576391, One(912), 1), // yoda expected
    (0x3C80759E, One(294), 0), // no-commented-out-tests
    (0x3CD49CEB, One(701), 0), // parameter-properties preferParameterProperty
    (0x3D523E1C, One(585), 0), // no-sparse-arrays unexpectedSparseArray
    (0x3D84DFFA, One(557), 0), // no-render-return-value
    (0x3D891842, One(17), 1), // aria-unsupported-elements
    (0x3DFD522C, One(800), 0), // prefer-response-static-json
    (0x3E23022F, One(151), 0), // explicit-module-boundary-types missingArgType
    (0x3F702622, One(150), 0), // explicit-module-boundary-types anyTypedArgUnnamed
    (0x3FD5EFB3, One(150), 0), // explicit-module-boundary-types anyTypedArg
    (0x4037A6A1, One(759), 0), // prefer-export-from
    (0x403D7235, One(485), 0), // no-misleading-character-class regionalIndicatorSymbol
    (0x40451C31, One(464), 0), // no-labels unexpectedLabel
    (0x406EC540, of_the_fix(false, First, 0), 0), // prefer-optional-catch-binding
    (0x40C9F62F, One(564), 1), // no-restricted-properties restrictedProperty
    (0x40CE6680, One(152), 0), // explicit-module-boundary-types missingReturnType
    (0x412B54E4, One(730), 0), // prefer-default-export
    (0x4144820D, One(398), 0), // no-extra-boolean-cast unexpectedCall
    (0x414AD720, Three(248), 0), // no-accumulating-spread loopSpread
    (0x41AC451D, One(415), 0), // no-floating-promises floatingVoid
    (0x41D3B241, One(660), 0), // no-useless-backreference forward
    (0x41FB84E2, One(497), 0), // no-multi-comp
    (0x42361FBE, One(660), 0), // no-useless-backreference intoNegativeLookaround
    (0x427DA840, One(446), 0), // no-import-type-side-effects useTopLevelQualifier
    (0x427F318F, One(631), 0), // no-unnecessary-slice-end
    (0x42A5A57F, One(198), 0), // jsx-filename-extension
    (0x4330D24B, One(1), 0), // accessor-pairs missingGetterInType
    (0x434A3BA3, One(2), 0), // accessor-pairs missingSetterInType
    (0x43773440, One(539), 0), // no-param-reassign assignmentToFunctionParam
    (0x442E57AD, One(456), 0), // no-invalid-void-type invalidVoidNotReturn
    (0x44DE9770, One(57), 1), // block-scoped-var outOfScope
    (0x44E6FF10, Three(880), 0), // unified-signatures omittingRestParameter
    (0x450297EB, One(552), 0), // no-redeclare redeclared
    (0x4576BB38, One(99), 0), // consistent-type-specifier-style
    (0x45E80181, One(194), 0), // interactive-supports-focus
    (0x467B6DF5, Three(357), 0), // no-duplicate-case unexpected
    (0x46896AB1, Three(248), 0), // no-accumulating-spread reduceSpread
    (0x4694688D, One(489), 0), // no-misused-new errorMessageClass
    (0x46BABB14, One(555), 1), // no-regex-spaces multipleSpaces
    (0x47001535, One(791), 1), // prefer-number-properties
    (0x470199BD, One(568), 0), // no-return-wrap
    (0x470CFC81, One(720), 0), // prefer-called-times
    (0x471B73CB, One(797), 0), // prefer-readonly preferReadonly
    (0x47AD07A4, Three(615), 0), // no-unexpected-multiline division
    (0x4905AD5B, of_the_fix(false, All, 0), 0), // consistent-type-definitions typeOverInterface
    (0x492CC0DB, One(155), 0), // export
    (0x4937801E, One(691), 1), // number-arg-out-of-range
    (0x49BD2FA0, One(491), 0), // no-misused-spread noFunctionSpreadInObject
    (0x49E9C313, One(598), 0), // no-thenable
    (0x49EA0B99, One(677), 0), // no-useless-rename unnecessarilyRenamed
    (0x4ADFEF5E, One(340), 0), // no-disabled-tests
    (0x4AE7B876, One(72), 1), // consistent-each-for
    (0x4B164347, One(678), 0), // no-useless-return unnecessaryReturn
    (0x4BA3B55F, One(686), 0), // no-webpack-loader-syntax
    (0x4BD8F9C6, One(182), 0), // hook-use-state
    (0x4BF1674B, Three(35), 0), // bad-match-all-arg
    (0x4C73543E, One(439), 0), // no-implicit-globals globalNonLexicalBinding
    (0x4C8838ED, One(710), 0), // prefer-as-const preferConstAssertion
    (0x4CAC9F7A, One(334), 0), // no-debugger unexpected
    (0x4CC7D5D8, One(705), 0), // prefer-array-flat-map
    (0x4CD9641B, One(871), 0), // throw-new-error
    (0x4CFCA4DC, One(23), 0), // arrow-body-style unexpectedEmptyBlock
    (0x4CFFC774, of_the_fix(false, First, 0), 0), // no-deprecated-functions
    (0x4D020C34, One(740), 0), // prefer-ending-with-an-expect
    (0x4D9BF559, Three(254), 0), // no-anonymous-default-export
    (0x4DA2D1D3, One(817), 0), // prefer-to-have-been-called-times
    (0x4DCA515A, One(632), 1), // no-unnecessary-type-constraint unnecessaryConstraint
    (0x4DF5D5D7, One(223), 0), // max-nested-callbacks exceed
    (0x4E109504, Three(846), 0), // require-unicode-regexp requireUFlag
    (0x4E226EF4, of_the_fix(false, First, 0), 0), // escape-case
    (0x4E99BC4E, One(257), 0), // no-aria-hidden-on-focusable
    (0x4E9DB508, Three(269), 0), // no-async-endpoint-handlers
    (0x4EF6DB9D, One(217), 0), // max-classes-per-file maximumExceeded
    (0x501D6803, One(895), 0), // valid-expect
    (0x50755686, One(393), 0), // no-explicit-any unexpectedAny
    (0x50F2970D, One(654), 0), // no-unwanted-polyfillio
    (0x50FFD073, One(592), 0), // no-sync-scripts
    (0x51203CCD, One(167), 0), // func-name-matching notMatchProperty
    (0x516ED453, One(458), 0), // no-is-mounted
    (0x51D024C7, One(662), 0), // no-useless-catch unnecessaryCatch
    (0x521DF4D2, One(61), 0), // callback-return
    (0x52347A5F, One(170), 0), // func-style expression
    (0x52821B9E, Three(595), 0), // no-test-return-statement
    (0x52A4DF84, One(128), 0), // erasing-op
    (0x52AF321E, One(887), 0), // use-isnan caseNaN
    (0x52B28245, of_the_fix(false, First, 0), 0), // curly unexpectedCurlyAfter
    (0x52BC8235, One(911), 0), // warn-todo
    (0x53091EDD, One(125), 1), // double-comparisons
    (0x531E3EC8, One(660), 0), // no-useless-backreference disjunctive
    (0x5354B870, One(682), 0), // no-var unexpectedVar
    (0x5398EA92, One(821), 0), // preserve-caught-error caughtErrorShadowed
    (0x53A1C515, One(811), 0), // prefer-structured-clone
    (0x53D9403E, One(474), 0), // no-magic-array-flat-depth
    (0x53FB4E46, One(411), 0), // no-floating-promises floatingPromiseArray
    (0x548F0D63, One(559), 0), // no-restricted-exports restrictedDefault
    (0x54B14656, One(75), 0), // consistent-generic-constructors preferConstructor
    (0x54CBEA1A, One(837), 0), // require-module-specifiers
    (0x5557B33E, Three(254), 0), // no-anonymous-default-export
    (0x556EEF87, One(134), 0), // exhaustive-deps
    (0x559A3AAA, One(21), 1), // array-callback-return mayReachEndOfIf
    (0x5646286A, One(483), 0), // no-misleading-character-class combiningClass
    (0x568E64EB, Three(40), 0), // bad-replace-all-arg
    (0x56D7811F, One(310), 0), // no-confusing-void-expression invalidVoidExpr
    (0x56E93E46, One(456), 0), // no-invalid-void-type invalidVoidNotReturnOrGeneric
    (0x5782557A, One(166), 0), // forward-ref-uses-ref
    (0x58A466ED, One(118), 0), // default-case missingDefaultCase
    (0x58DA34B4, One(227), 0), // media-has-caption
    (0x590E840B, of_the_fix(false, First, 0), 0), // prefer-spy-on
    (0x593BD524, One(589), 0), // no-string-refs
    (0x59B22FBB, One(251), 0), // no-alert unexpected
    (0x59F21520, One(719), 1), // prefer-called-once
    (0x5A2BB6EF, One(663), 0), // no-useless-catch unnecessaryCatchClause
    (0x5A2D5611, One(456), 0), // no-invalid-void-type invalidVoidForGeneric
    (0x5A60BB58, of_the_fix(false, First, 0), 0), // no-useless-collection-argument
    (0x5A80AFB1, One(824), 0), // radix invalidRadix
    (0x5A9E7553, One(487), 0), // no-misleading-character-class surrogatePairWithoutUFlag
    (0x5AF1595D, One(170), 0), // func-style declaration
    (0x5B734369, One(501), 1), // no-named-as-default-member
    (0x5BEE2655, One(435), 0), // no-immediate-mutation
    (0x5C900B00, One(683), 0), // no-var-requires noVarReqs
    (0x5CC6FCF8, One(507), 1), // no-negation-in-equality-check
    (0x5D0F92E9, One(475), 0), // no-magic-numbers noMagic
    (0x5D441852, One(454), 0), // no-interpolation-in-snapshots
    (0x5D7B2CB9, One(221), 1), // max-lines exceed
    (0x5DB72799, One(671), 0), // no-useless-empty-export uselessExport
    (0x5E3E5C10, One(679), 0), // no-useless-spread
    (0x5E7E7B07, One(490), 0), // no-misused-new errorMessageInterface
    (0x5E7FBF0E, Three(579), 3), // no-shadow noShadow
    (0x5E808371, One(9), 0), // alt-text
    (0x5E9582B5, One(572), 0), // no-self-compare comparingToSelf
    (0x5E98BF1B, One(750), 1), // prefer-expect-assertions
    (0x5E9FBEEF, One(338), 0), // no-did-update-set-state
    (0x5ED5EA27, One(602), 0), // no-this-before-super noBeforeSuper
    (0x5EF87FAD, One(599), 0), // no-this-alias thisAssignment
    (0x5EFB52AD, One(441), 0), // no-implied-eval execScript
    (0x5F1AAC0D, Three(515), 0), // no-new-func noFunctionConstructor
    (0x5FC22DE6, One(901), 0), // valid-expect-in-promise
    (0x60274EAA, One(159), 0), // exports-style
    (0x6050AC87, of_the_fix(false, All, 0), 0), // array-type errorStringArray
    (0x6064B3C1, One(633), 0), // no-unneeded-async-expect-function
    (0x6099C903, Three(3), 1), // adjacent-overload-signatures adjacentSignature
    (0x6182F6AE, One(130), 0), // error-message
    (0x619CF5B6, One(484), 0), // no-misleading-character-class emojiModifier
    (0x61C4E6B8, One(674), 0), // no-useless-iterator-to-array
    (0x61D610DB, One(131), 0), // error-message
    (0x62896888, One(20), 1), // array-callback-return mayFallThroughSwitch
    (0x62F126DF, One(286), 0), // no-case-declarations unexpected
    (0x62FB98DC, Three(618), 0), // no-unexpected-multiline function
    (0x63289AA6, One(855), 1), // role-has-required-aria-props
    (0x639C39AB, One(135), 0), // exhaustive-deps
    (0x643A3C40, One(172), 0), // global-require
    (0x645CBB4B, One(262), 0), // no-array-method-this-argument
    (0x6490DABD, One(312), 0), // no-confusing-void-expression invalidVoidExprReturn
    (0x649BA4B6, One(76), 0), // consistent-generic-constructors preferTypeAnnotation
    (0x65D9A51E, One(798), 0), // prefer-reflect-apply
    (0x65E653F3, One(213), 0), // jsx-props-no-spread-multi
    (0x65F96EAF, One(563), 1), // no-restricted-matchers
    (0x66A86706, One(24), 0), // arrow-body-style unexpectedSingleBlock
    (0x67B8A380, One(409), 0), // no-find-dom-node
    (0x67CED70F, One(226), 0), // max-params exceed
    (0x67D5835A, One(793), 0), // prefer-object-spread useLiteralMessage
    (0x680FDFE8, One(167), 0), // func-name-matching notMatchVariable
    (0x686191F3, of_the_fix(false, First, 0), 0), // function-component-definition
    (0x686EEEB2, One(331), 0), // no-css-tags
    (0x68A1A5BB, One(136), 0), // exhaustive-deps
    (0x68B710EF, One(676), 0), // no-useless-promise-resolve-reject
    (0x692FE0A5, One(562), 1), // no-restricted-imports pathWithCustomMessage
    (0x697C0C1E, One(137), 0), // exhaustive-deps
    (0x69ABD53A, One(207), 0), // jsx-no-literals
    (0x6A29E837, of_the_fix(false, First, 0), 0), // prefer-math-trunc
    (0x6B9BE531, of_the_fix(false, First, 0), 0), // prefer-prototype-methods
    (0x6B9CF3B0, One(181), 0), // hoisted-apis-on-top
    (0x6BCE2B27, Three(849), 0), // require-unicode-regexp requireVFlag
    (0x6BE5A143, One(902), 0), // valid-title
    (0x6C4F7631, One(315), 0), // no-console unexpected
    (0x6C63014F, One(570), 0), // no-script-url unexpectedScriptURL
    (0x6CAC0AD0, Three(401), 0), // no-extra-non-null-assertion noExtraNonNullAssertion
    (0x6D013E47, One(506), 0), // no-negated-condition
    (0x6D67D4DA, One(809), 0), // prefer-strict-equal
    (0x6D94AF0C, One(540), 0), // no-param-reassign assignmentToFunctionParamProp
    (0x6DA49EAF, One(49), 0), // ban-types
    (0x6DE8A23F, of_the_fix(false, First, 0), 0), // no-empty-named-blocks
    (0x6E4044E9, One(604), 0), // no-this-in-sfc
    (0x6E5C6A36, of_the_fix(false, First, 0), 0), // function-component-definition
    (0x6E682581, One(835), 1), // require-mock-type-parameters
    (0x6E72D2C7, One(821), 0), // preserve-caught-error missingCause
    (0x6EB15CD7, of_the_fix(false, First, 0), 0), // no-null
    (0x6F0AB04C, One(562), 1), // no-restricted-imports everythingWithAllowedImportNamePatternWithCustomMessage
    (0x6F1DD394, of_the_fix(false, First, 0), 0), // object-shorthand expectedMethodShorthand
    (0x6FF55E58, One(670), 0), // no-useless-default-assignment uselessUndefined
    (0x70393C91, One(231), 0), // missing-throw
    (0x7043F91E, One(464), 0), // no-labels unexpectedLabelInContinue
    (0x70558DB2, One(77), 0), // consistent-indexed-object-style preferIndexSignature
    (0x70962A56, One(729), 0), // prefer-date-now
    (0x70BF82FC, One(450), 1), // no-inner-declarations moveDeclToRoot
    (0x710AF355, of_the_fix(false, First, 0), 0), // ban-tslint-comment commentDetected
    (0x718431E5, One(95), 0), // consistent-type-imports noImportTypeAnnotations
    (0x71BF1211, One(591), 0), // no-styled-jsx-in-document
    (0x71C9BA62, Three(477), 0), // no-map-spread
    (0x71DC9E56, One(160), 0), // exports-style
    (0x71E0D9DB, One(137), 0), // exhaustive-deps
    (0x72888656, One(100), 0), // consistent-type-specifier-style
    (0x7289F291, One(307), 0), // no-confusing-non-null-assertion confusingAssign
    (0x7316FAB1, One(530), 0), // no-noninteractive-element-interactions
    (0x7350C08B, One(891), 0), // valid-describe-callback
    (0x7370F353, of_the_fix(false, First, 0), 0), // consistent-type-assertions as
    (0x73ADA4DE, of_the_fix(false, First, 0), 0), // function-component-definition
    (0x73BD2A09, One(888), 0), // use-isnan comparisonWithNaN
    (0x73DAE700, One(692), 0), // number-literal-case
    (0x73E689A2, One(177), 0), // grouped-accessor-pairs invalidOrder
    (0x73FB5C91, One(523), 0), // no-non-null-asserted-nullish-coalescing noNonNullAssertedNullishCoalescing
    (0x74052CCF, One(153), 0), // explicit-timer-delay
    (0x7438222A, One(653), 0), // no-unused-private-class-members unusedPrivateClassMember
    (0x74772748, One(225), 1), // max-nested-describe
    (0x7485E6BA, One(866), 0), // switch-case-braces
    (0x754980E5, One(833), 0), // require-hook
    (0x758E4948, One(38), 1), // bad-object-literal-comparison
    (0x7616A2A5, One(562), 1), // no-restricted-imports everythingWithCustomMessage
    (0x764B4A7A, One(819), 0), // prefer-ts-expect-error preferExpectErrorComment
    (0x767C35BB, One(161), 1), // extensions
    (0x76C7C203, One(858), 0), // scope
    (0x76FFA74C, One(267), 0), // no-async-await
    (0x771243CE, One(818), 0), // prefer-top-level-await
    (0x776978BB, One(138), 0), // exhaustive-deps
    (0x77997183, One(275), 0), // no-await-in-loop unexpectedAwait
    (0x77CDA732, One(638), 0), // no-unreadable-iife
    (0x77F7FD45, One(870), 0), // tabindex-no-positive
    (0x78474DB3, One(889), 0), // use-isnan indexOfNaN
    (0x784C8E87, One(328), 0), // no-constructor-return unexpected
    (0x78F396CE, One(764), 1), // prefer-function-type unexpectedThisOnFunctionOnlyInterface
    (0x797AD421, Three(524), 0), // no-non-null-asserted-optional-chain noNonNullOptionalChain
    (0x798BFAED, One(62), 0), // capitalized-comments unexpectedLowercaseComment
    (0x79D87FD1, One(716), 0), // prefer-await-to-then
    (0x7A5C1437, One(799), 0), // prefer-regexp-test
    (0x7A83C681, Three(86), 0), // consistent-type-assertions unexpectedArrayTypeAssertion
    (0x7B1FB820, One(830), 0), // require-array-join-separator
    (0x7B6BF287, of_the_fix(false, All, 0), 0), // consistent-type-definitions interfaceOverType
    (0x7B8E21D0, One(872), 0), // triple-slash-reference tripleSlashReference
    (0x7BA56C1B, One(640), 0), // no-unsafe-member-access unsafeThisMemberExpression
    (0x7BA57611, One(498), 0), // no-multi-str multilineString
    (0x7BE6F2F9, One(313), 0), // no-confusing-void-expression invalidVoidExprReturnLast
    (0x7CBAD694, of_the_fix(false, First, 0), 0), // no-test-prefixes
    (0x7CC8D36D, One(139), 0), // exhaustive-deps
    (0x7D500530, One(910), 0), // void-dom-elements-no-children
    (0x7D8088CC, One(739), 1), // prefer-each
    (0x7D83D2BA, One(727), 1), // prefer-comparison-matcher
    (0x7D9F2601, One(410), 0), // no-floating-promises floating
    (0x7DA5DD05, One(66), 0), // class-literal-property-style preferFieldStyle
    (0x7DA8315F, One(453), 0), // no-interactive-element-to-noninteractive-role
    (0x7DEA67FA, Three(527), 0), // no-non-null-assertion noNonNull
    (0x7DF33290, of_the_fix(false, First, 0), 0), // explicit-length-check
    (0x7E03A6C9, One(406), 0), // no-extraneous-class onlyStatic
    (0x7E327F05, One(721), 1), // prefer-called-with
    (0x7E38A935, One(105), 0), // const-comparisons
    (0x7E3DED4F, One(186), 0), // iframe-has-title
    (0x7E5C6924, One(117), 1), // default
    (0x7F15A285, One(442), 0), // no-implied-eval impliedEval
    (0x7F38C6CD, of_the_fix(false, First, 0), 0), // jsx-boolean-value
    (0x7F86BC56, of_the_fix(false, First, 0), 0), // catch-error-name
    (0x7F943CCB, One(536), 0), // no-object-type-as-default-prop
    (0x801EF696, One(19), 1), // array-callback-return expectedNoReturnValue
    (0x80AC457B, One(50), 0), // ban-types
    (0x810DC9D9, One(206), 0), // jsx-no-new-object-as-prop
    (0x81181E35, One(140), 0), // exhaustive-deps
    (0x81ECF042, of_the_fix(false, First, 0), 0), // no-unused-labels unused
    (0x81F75B05, One(258), 0), // no-array-callback-reference
    (0x822664B6, One(909), 0), // vars-on-top top
    (0x823B2F2D, One(146), 0), // expect-expect
    (0x823B4E38, One(204), 0), // jsx-no-constructed-context-values
    (0x82801981, One(779), 1), // prefer-lowercase-title
    (0x82B929F0, One(175), 0), // group-exports
    (0x8303A4C7, One(584), 0), // no-single-promise-in-promise-methods
    (0x831BBAE5, One(522), 0), // no-nodejs-modules
    (0x83439EE7, One(206), 0), // jsx-no-new-function-as-prop
    (0x83451D02, One(59), 1), // button-has-type
    (0x835861AA, One(825), 0), // radix missingParameters
    (0x8360E1E4, One(395), 0), // no-exports-assign
    (0x838A42D5, of_the_fix(false, First, 0), 0), // prefer-string-replace-all
    (0x83E2D9AC, of_the_fix(false, First, 0), 0), // prefer-string-replace-all
    (0x841A2F88, One(148), 0), // explicit-member-accessibility missingAccessibility
    (0x84551859, One(64), 0), // checked-requires-onchange-or-readonly
    (0x8471437D, One(843), 0), // require-test-timeout
    (0x8484729E, One(508), 0), // no-nested-ternary
    (0x84AB82D0, One(804), 0), // prefer-snapshot-hint
    (0x84BCD86A, of_the_fix(false, First, 0), 0), // sort-imports sortMembersAlphabetically
    (0x84CC3F4B, One(534), 0), // no-obj-calls unexpectedCall
    (0x853D3736, One(173), 0), // google-font-display
    (0x856525FC, of_the_fix(false, First, 0), 0), // curly missingCurlyAfterCondition
    (0x85AF642F, Three(317), 2), // no-const-assign const
    (0x872D13BE, One(646), 1), // no-unsafe-negation unexpected
    (0x87322D5F, One(314), 1), // no-console limited
    (0x8768308E, One(339), 0), // no-direct-mutation-state
    (0x87889300, One(844), 0), // require-test-timeout
    (0x87A24908, One(184), 0), // html-has-lang
    (0x87C0B7B7, One(378), 0), // no-dynamic-require
    (0x87C6AE3E, Three(735), 0), // prefer-dom-node-remove
    (0x87E2FF31, Three(254), 0), // no-anonymous-default-export
    (0x880E8CF7, One(466), 0), // no-lone-blocks redundantBlock
    (0x882EDA31, One(311), 0), // no-confusing-void-expression invalidVoidExprArrow
    (0x88327F58, One(520), 1), // no-new-statics
    (0x88746CF5, One(245), 0), // no-abusive-eslint-disable
    (0x8874C6B0, One(235), 0), // namespace
    (0x88C9C57E, One(99), 0), // consistent-type-specifier-style
    (0x89246B3B, One(379), 0), // no-else-return unexpected
    (0x8963104E, One(903), 0), // valid-title
    (0x898463D4, One(542), 1), // no-plusplus unexpectedUnaryOp
    (0x899EA758, One(285), 0), // no-caller unexpected
    (0x8A213DEC, One(836), 0), // require-module-attributes
    (0x8A89DF45, One(634), 0), // no-unneeded-ternary unnecessaryConditionalAssignment
    (0x8A9605FE, Three(471), 0), // no-loss-of-precision noLossOfPrecision
    (0x8ABD121A, One(137), 0), // exhaustive-deps
    (0x8AD4C18A, One(834), 0), // require-local-test-context-for-concurrent-snapshots
    (0x8AE6F07F, One(867), 0), // switch-case-braces
    (0x8B6CA6B8, of_the_fix(false, First, 839), 0), // require-post-message-target-origin
    (0x8B9EEF6D, of_the_fix(true, First, 0), 0), // jsx-no-useless-fragment
    (0x8BA4818B, One(106), 0), // const-comparisons
    (0x8C9A3028, of_the_fix(false, First, 0), 0), // consistent-empty-array-spread
    (0x8D1408A7, Three(576), 7), // no-shadow noEnumShadow
    (0x8D4EEAAF, One(405), 0), // no-extraneous-class onlyConstructor
    (0x8D628DE3, One(387), 0), // no-empty-static-block unexpected
    (0x8D7C59AE, One(297), 0), // no-cond-assign unexpected
    (0x8D88D57B, One(68), 1), // class-methods-use-this missingThis
    (0x8DA73E29, Three(755), 1), // prefer-expect-type-of
    (0x8EC92FCB, One(612), 0), // no-unassigned-vars unassigned
    (0x9021BBE3, One(386), 0), // no-empty-object-type noEmptyObject
    (0x90BD2E9A, Three(237), 0), // new-cap lower
    (0x90C03318, One(784), 1), // prefer-named-capture-group required
    (0x914A5EF2, One(284), 0), // no-callback-in-promise
    (0x9199CAC4, One(408), 0), // no-fallthrough unusedFallthroughComment
    (0x92842C3D, One(562), 1), // no-restricted-imports everythingWithAllowImportNamesAndCustomMessage
    (0x9285F5BC, One(896), 0), // valid-expect
    (0x92899C84, One(561), 0), // no-restricted-globals customMessage
    (0x92AF00FF, Three(254), 0), // no-anonymous-default-export
    (0x92DE5142, One(13), 0), // anchor-is-valid
    (0x930BC3EC, One(680), 0), // no-useless-switch-case
    (0x930CE0BB, One(246), 0), // no-access-key
    (0x936D88A9, One(309), 0), // no-confusing-set-timeout
    (0x93E80588, Three(45), 1), // ban-ts-comment tsDirectiveCommentRequiresDescription
    (0x93FAA91F, One(674), 0), // no-useless-iterator-to-array
    (0x93FFFE35, Three(480), 0), // no-map-spread
    (0x94116C9A, of_the_fix(false, First, 689), 4), // no-wrapper-object-types bannedClassType
    (0x94EDCB08, One(644), 0), // no-unsafe-finally unsafeUsage
    (0x95283D32, One(329), 0), // no-continue unexpected
    (0x95474AF7, of_the_fix(false, First, 0), 0), // prefer-string-starts-ends-with
    (0x9573D46D, One(174), 0), // google-font-preconnect
    (0x95E7A825, One(842), 0), // require-test-timeout
    (0x95FED5F5, One(672), 0), // no-useless-error-capture-stack-trace
    (0x96A87BDE, One(200), 0), // jsx-fragments
    (0x97730A48, One(476), 0), // no-magic-numbers useConst
    (0x97CD5B21, One(229), 0), // method-signature-style errorProperty
    (0x98214428, One(795), 0), // prefer-promise-reject-errors rejectAnError
    (0x984ACAFA, of_the_fix(false, First, 0), 0), // explicit-length-check
    (0x9860D0C0, One(734), 0), // prefer-dom-node-append
    (0x98B1D184, One(723), 0), // prefer-class-fields
    (0x98C42E09, One(648), 0), // no-unsafe-optional-chaining unsafeOptionalChain
    (0x98F58515, One(169), 0), // func-names unnamed
    (0x98F68BCF, of_the_fix(false, First, 0), 0), // prefer-math-min-max
    (0x99B68D6E, One(684), 0), // no-void noVoid
    (0x99EBCD74, One(703), 0), // prefer-array-find
    (0x9A28EDC3, One(457), 0), // no-irregular-whitespace noIrregularWhitespace
    (0x9ABD1E60, One(455), 0), // no-invalid-remove-event-listener
    (0x9AF51DCD, One(382), 0), // no-empty-file
    (0x9B264F04, One(69), 0), // click-events-have-key-events
    (0x9B4D6B59, One(445), 0), // no-import-node-test
    (0x9B7C4335, One(224), 0), // max-nested-calls
    (0x9C1E1379, One(456), 0), // no-invalid-void-type invalidVoidUnionConstituent
    (0x9C4495C1, One(215), 0), // label-has-associated-control
    (0x9CAFDEED, One(873), 0), // unambiguous
    (0x9CE88A4B, One(704), 0), // prefer-array-flat
    (0x9CEA1942, One(845), 1), // require-to-throw-message
    (0x9D0C9DCE, One(276), 0), // no-await-in-promise-methods
    (0x9DA05EA0, One(208), 0), // jsx-no-literals
    (0x9DC29154, One(219), 0), // max-depth tooDeeply
    (0x9E01697E, of_the_fix(false, First, 0), 0), // jsx-boolean-value
    (0x9E236B61, One(428), 0), // no-identical-title
    (0x9EC2FE79, One(892), 0), // valid-describe-callback
    (0x9FE1D3CE, One(674), 0), // no-useless-iterator-to-array
    (0xA01AC578, One(724), 0), // prefer-class-fields
    (0xA032BEA0, Three(368), 0), // no-duplicate-imports import
    (0xA04674AC, of_the_fix(false, First, 0), 0), // prefer-dom-node-dataset
    (0xA087B343, One(427), 0), // no-html-link-for-pages
    (0xA09B127D, One(43), 1), // ban-ts-comment tsDirectiveComment
    (0xA0D015A0, One(416), 0), // no-focused-tests
    (0xA0E2E977, of_the_fix(true, First, 0), 0), // jsx-curly-brace-presence
    (0xA0E3B9A9, One(904), 0), // valid-title
    (0xA11E2B4B, One(107), 1), // const-comparisons
    (0xA1395355, One(265), 0), // no-array-sort
    (0xA13F3933, One(897), 0), // valid-expect
    (0xA14925FC, One(187), 0), // iframe-missing-sandbox
    (0xA1656366, One(731), 0), // prefer-default-parameters
    (0xA1AA64D9, One(862), 0), // strict-boolean-expressions conditionErrorNullableObject
    (0xA1EBE911, One(565), 0), // no-return-assign arrowAssignment
    (0xA21E96A6, One(905), 0), // valid-title
    (0xA239492E, Three(421), 3), // no-global-assign globalShouldNotBeModified
    (0xA24F6A04, One(562), 1), // no-restricted-imports patternAndEverythingWithCustomMessage
    (0xA299A7EB, of_the_fix(false, First, 0), 0), // prefer-prototype-methods
    (0xA2BB9DDF, Three(254), 0), // no-anonymous-default-export
    (0xA35BBFF4, One(535), 0), // no-object-constructor preferLiteral
    (0xA36125B5, One(228), 0), // method-signature-style errorMethod
    (0xA37216DA, One(496), 0), // no-multi-assign unexpectedChain
    (0xA39911F7, One(30), 0), // await-thenable invalidPromiseAggregatorInput
    (0xA3CD3DCF, One(874), 0), // unbound-method unboundWithoutThisAnnotation
    (0xA3FE0095, One(176), 0), // group-exports
    (0xA45423F7, One(893), 0), // valid-describe-callback
    (0xA482BD6C, One(218), 0), // max-dependencies
    (0xA4A4D8EB, Three(365), 0), // no-duplicate-imports exportAs
    (0xA4C84134, One(706), 0), // prefer-array-flat-map
    (0xA4E55B7F, One(831), 0), // require-await missingAwait
    (0xA4EBAE34, One(519), 0), // no-new-require
    (0xA4FEC9F7, One(509), 0), // no-nested-ternary
    (0xA550E5CF, One(790), 1), // prefer-number-coercion
    (0xA5713C0F, One(709), 0), // prefer-arrow-callback preferArrowCallback
    (0xA59D59AF, One(636), 0), // no-unreachable unreachableCode
    (0xA5DF2034, One(502), 0), // no-named-default
    (0xA63FC691, One(234), 1), // named
    (0xA680EB4A, of_the_fix(false, First, 0), 0), // prefer-importing-jest-globals
    (0xA6848C64, One(651), 1), // no-untyped-mock-factory
    (0xA6A3075C, One(154), 0), // explicit-timer-delay
    (0xA6C73740, One(179), 0), // handle-callback-err
    (0xA6DF883A, Three(301), 0), // no-confusing-array-with
    (0xA740D924, One(201), 0), // jsx-key
    (0xA7D7E9CA, One(321), 0), // no-constant-binary-expression alwaysNew
    (0xA7EE021C, One(102), 1), // consistent-vitest-vi
    (0xA83C3DF8, One(220), 1), // max-expects
    (0xA86EE8DB, One(666), 0), // no-useless-constructor noUselessConstructor
    (0xA88D6F0B, One(74), 1), // consistent-function-scoping
    (0xA8D87DAF, One(503), 0), // no-named-export
    (0xA94E0D11, of_the_fix(false, First, 0), 0), // prefer-string-raw
    (0xA95AEAAE, One(600), 0), // no-this-alias thisDestructure
    (0xA97AE8D9, One(764), 1), // prefer-function-type functionTypeOverCallableType
    (0xA9FE8F0B, One(751), 1), // prefer-expect-assertions
    (0xAA0E7FA2, One(116), 0), // control-has-associated-label
    (0xAA1D712D, One(548), 1), // no-prototype-builtins prototypeBuildIn
    (0xAA3BF80C, One(162), 1), // extensions
    (0xAABFCF80, One(544), 0), // no-process-exit
    (0xAAC75309, Three(291), 0), // no-clone-element
    (0xAAC8A001, One(147), 0), // explicit-function-return-type missingReturnType
    (0xAB22E794, One(504), 0), // no-namespace
    (0xAB539868, One(812), 1), // prefer-tag-over-role
    (0xAB8EDC17, One(859), 0), // self-closing-comp
    (0xAB94B666, One(114), 0), // constructor-super missingAll
    (0xABA004B6, One(769), 0), // prefer-hooks-on-top
    (0xAC654D44, One(630), 0), // no-unnecessary-parameter-property-assignment unnecessaryAssign
    (0xACC35EBF, of_the_fix(false, First, 0), 0), // no-test-prefixes
    (0xAD4FC5F0, One(559), 0), // no-restricted-exports restrictedDefault
    (0xADA5BAA4, One(296), 0), // no-compare-neg-zero unexpected
    (0xADB36002, of_the_fix(false, First, 0), 0), // object-shorthand expectedLiteralMethodLongform
    (0xADEA61F1, One(2), 0), // accessor-pairs missingSetterInClass
    (0xAE5D281B, Three(354), 0), // no-dupe-keys unexpected
    (0xAE60BBEC, One(71), 0), // consistent-date-clone
    (0xAE6C3BCE, One(188), 0), // iframe-missing-sandbox
    (0xAECB2492, One(693), 0), // number-literal-case
    (0xAEDB1D74, One(448), 0), // no-inferrable-types noInferrableType
    (0xAF7C8CF2, One(2), 0), // accessor-pairs missingSetterInObjectLiteral
    (0xAF9C23C1, One(635), 0), // no-unneeded-ternary unnecessaryConditionalExpression
    (0xAFEE01B5, One(559), 0), // no-restricted-exports restrictedDefault
    (0xAFEFB54A, One(562), 1), // no-restricted-imports patternWithCustomMessage
    (0xB01C9482, One(611), 0), // no-unassigned-import
    (0xB053E134, One(640), 0), // no-unsafe-return unsafeReturnThis
    (0xB0BF39D1, One(732), 0), // prefer-describe-function-title
    (0xB0C09E23, One(587), 0), // no-static-element-interactions
    (0xB0CC8CAD, One(690), 1), // no-zero-fractions
    (0xB0D16A25, One(426), 0), // no-hooks
    (0xB107B85E, One(532), 0), // no-noninteractive-tabindex
    (0xB12E5352, One(63), 0), // capitalized-comments unexpectedUppercaseComment
    (0xB19ED905, One(252), 1), // no-alias-methods
    (0xB1A814F2, of_the_fix(false, All, 0), 0), // array-type errorStringGenericSimple
    (0xB2443EEA, One(521), 0), // no-new-wrappers notAConstructor
    (0xB2C78415, One(413), 0), // no-floating-promises floatingUselessRejectionHandler
    (0xB2D20D3D, One(141), 0), // exhaustive-deps
    (0xB34DAB4C, One(12), 0), // anchor-has-content
    (0xB42720B5, One(34), 0), // bad-comparison-sequence
    (0xB4484750, One(561), 0), // no-restricted-globals defaultMessage
    (0xB4873FEE, One(647), 0), // no-unsafe-optional-chaining unsafeArithmetic
    (0xB5917204, One(424), 0), // no-head-element
    (0xB5B04ECD, One(142), 0), // exhaustive-deps
    (0xB5D340E7, One(374), 0), // no-duplicates
    (0xB63C4486, One(266), 0), // no-assign-module-variable
    (0xB6495F3F, of_the_fix(false, First, 0), 0), // prefer-numeric-literals useLiteral
    (0xB6FEBA1F, One(261), 0), // no-array-index-key
    (0xB733DAF4, One(697), 0), // only-used-in-recursion
    (0xB7A2A3A3, One(537), 0), // no-page-custom-font
    (0xB7B1DBBD, One(752), 1), // prefer-expect-assertions
    (0xB7E68201, One(273), 0), // no-autofocus
    (0xB888DD19, One(189), 0), // iframe-missing-sandbox
    (0xB8C4F070, Three(430), 0), // no-img-element
    (0xB908C6F3, One(614), 1), // no-underscore-dangle unexpectedUnderscore
    (0xB94A4974, One(452), 0), // no-instanceof-builtins
    (0xB9649756, One(506), 0), // no-negated-condition unexpectedNegated
    (0xB9C0660B, One(821), 0), // preserve-caught-error incorrectCause
    (0xB9DF2664, One(637), 0), // no-unreachable-loop invalid
    (0xBA35DD43, One(803), 0), // prefer-single-call
    (0xBAAFC30B, One(754), 0), // prefer-expect-resolves
    (0xBACA7360, One(236), 0), // namespace
    (0xBAEB47B1, One(771), 0), // prefer-import-meta-properties
    (0xBAFB064B, One(324), 0), // no-constant-binary-expression constantShortCircuit
    (0xBB8E23B2, of_the_fix(false, First, 0), 0), // no-typeof-undefined
    (0xBB941C45, Three(51), 0), // ban-types
    (0xBBB60C82, One(814), 0), // prefer-ternary
    (0xBBDC9945, One(216), 0), // lang
    (0xBC20EDA4, One(906), 0), // valid-title
    (0xBC23A703, One(605), 0), // no-throw-literal object
    (0xBC32FC4D, One(183), 0), // hook-use-state
    (0xBC421B75, One(606), 0), // no-title-in-document-head
    (0xBD73E97F, One(861), 0), // strict-boolean-expressions conditionErrorAny
    (0xBD8E1A3D, One(259), 0), // no-array-constructor useLiteral
    (0xBDAA4491, One(792), 0), // prefer-object-from-entries
    (0xBDFFAF10, One(894), 0), // valid-describe-callback
    (0xBE055C31, One(685), 0), // no-warning-comments unexpectedComment
    (0xBE2456FB, of_the_fix(false, First, 0), 0), // operator-assignment replaced
    (0xBE70D594, One(308), 0), // no-confusing-non-null-assertion confusingEqual
    (0xBEAC061A, One(495), 0), // no-mocks-import
    (0xBEC89835, One(794), 0), // prefer-object-spread useSpreadMessage
    (0xBED5EED0, One(773), 0), // prefer-jest-mocked
    (0xBED66FB7, One(493), 0), // no-misused-spread noPromiseSpreadInObject
    (0xBFCE433D, of_the_fix(false, First, 0), 0), // prefer-array-some
    (0xBFDF8F0D, One(44), 1), // ban-ts-comment tsDirectiveCommentDescriptionNotMatchPattern
    (0xBFDF9F72, One(115), 0), // constructor-super missingSome
    (0xC032897D, One(26), 0), // avoid-new
    (0xC0F0D78A, One(593), 0), // no-template-curly-in-string unexpectedTemplateExpression
    (0xC12E8574, One(79), 0), // consistent-template-literal-escape
    (0xC145FD68, of_the_fix(false, First, 0), 0), // curly unexpectedCurlyAfterCondition
    (0xC1BBA066, One(15), 1), // approx-constant
    (0xC1E275BC, One(605), 0), // no-throw-literal undef
    (0xC20FCE34, One(202), 0), // jsx-key
    (0xC2AE9121, Three(667), 0), // no-useless-constructor noUselessConstructor
    (0xC2D7E692, One(857), 0), // rules-of-hooks
    (0xC316E67B, Three(621), 0), // no-unexpected-multiline property
    (0xC370CDF0, One(363), 0), // no-duplicate-head
    (0xC3C08E65, Three(624), 0), // no-unexpected-multiline taggedTemplate
    (0xC434E826, of_the_fix(false, First, 0), 0), // prefer-to-be-truthy
    (0xC482FC9B, One(14), 0), // anchor-is-valid
    (0xC488C6EB, One(264), 0), // no-array-reverse
    (0xC4AF6C32, One(744), 0), // prefer-equality-matcher
    (0xC4DE872E, of_the_fix(false, First, 0), 0), // curly missingCurlyAfter
    (0xC52F8ED0, One(610), 1), // no-typos
    (0xC5475EA0, One(48), 0), // ban-ts-comment tsIgnoreInsteadOfExpectError
    (0xC572B7B0, Three(351), 0), // no-dupe-else-if unexpected
    (0xC5D7A5F7, of_the_fix(false, First, 0), 0), // object-shorthand expectedPropertyShorthand
    (0xC5DC7B37, One(566), 0), // no-return-in-finally
    (0xC5ECFCBE, One(547), 0), // no-proto unexpectedProto
    (0xC5F3BE7B, One(777), 0), // prefer-literal-enum-member notLiteralOrBitwiseExpression
    (0xC6329069, One(564), 1), // no-restricted-properties restrictedObjectProperty
    (0xC63E95BF, One(456), 0), // no-invalid-void-type invalidVoidNotReturnOrThisParamOrGeneric
    (0xC647D82B, One(554), 1), // no-redundant-roles
    (0xC685CA97, One(888), 0), // use-isnan comparisonWithNaN
    (0xC73061CC, One(753), 1), // prefer-expect-assertions
    (0xC8028D27, One(143), 0), // exhaustive-deps
    (0xC86D58A2, Three(656), 0), // no-use-before-define noUseBeforeDefine
    (0xC8913BD3, One(124), 0), // display-name
    (0xC8BAEEFF, One(710), 0), // prefer-as-const variableConstAssertion
    (0xC8F042E1, One(778), 0), // prefer-logical-operator-over-ternary
    (0xC91DE135, One(864), 0), // strict-boolean-expressions conditionErrorNullableNumber
    (0xC9719D8B, One(209), 0), // jsx-no-literals
    (0xC996806F, One(590), 0), // no-string-refs
    (0xC9D5923E, One(722), 0), // prefer-catch
    (0xCA374218, One(65), 0), // checked-requires-onchange-or-readonly
    (0xCA492FE3, One(806), 0), // prefer-spread
    (0xCA94982D, One(562), 1), // no-restricted-imports patternAndEverythingWithRegexImportNameAndCustomMessage
    (0xCB07DF7B, One(191), 0), // init-declarations initialized
    (0xCB71F493, One(575), 0), // no-setter-return returnsValue
    (0xCB8E4930, One(307), 0), // no-confusing-non-null-assertion confusingOperator
    (0xCBA8F125, Three(774), 1), // prefer-keyboard-event-key
    (0xCBA9E28F, of_the_fix(false, First, 0), 0), // object-shorthand expectedMethodLongform
    (0xCBB7DD3F, One(381), 0), // no-empty-character-class unexpected
    (0xCC066ACD, One(559), 0), // no-restricted-exports restrictedDefault
    (0xCC4B2F1B, One(639), 1), // no-unsafe
    (0xCC71F6DB, One(673), 0), // no-useless-fallback-in-spread
    (0xCCDD9B36, Three(390), 0), // no-ex-assign unexpected
    (0xCD6621D3, One(464), 0), // no-labels unexpectedLabelInBreak
    (0xCD7F4FBF, One(28), 0), // await-thenable awaitUsingOfNonAsyncDisposable
    (0xCDE5A417, One(394), 0), // no-export
    (0xCDF86BF9, One(661), 0), // no-useless-call unnecessaryCall
    (0xCEE2352D, One(253), 1), // no-amd
    (0xCF7B7BEF, One(598), 0), // no-thenable
    (0xCF8B528E, One(725), 0), // prefer-classlist-toggle
    (0xCFE5E9CF, One(465), 0), // no-length-as-slice-end
    (0xD000C747, of_the_fix(false, First, 0), 0), // prefer-to-be-falsy
    (0xD0426592, One(32), 1), // bad-bitwise-operator
    (0xD047BF05, One(674), 0), // no-useless-iterator-to-array
    (0xD072A46A, One(280), 0), // no-base-to-string baseArrayJoin
    (0xD105B19C, One(323), 1), // no-constant-binary-expression constantRelationalComparison
    (0xD184DFD1, One(868), 0), // switch-case-braces
    (0xD1AE8B99, One(816), 0), // prefer-to-have-been-called
    (0xD1CF7539, One(232), 0), // mouse-events-have-key-events
    (0xD1D097D1, One(10), 0), // alt-text
    (0xD1E9140B, One(629), 0), // no-unnecessary-await
    (0xD20E792C, One(770), 1), // prefer-import-in-mock
    (0xD359EFA2, One(78), 0), // consistent-indexed-object-style preferRecord
    (0xD39CB001, One(144), 0), // exhaustive-deps
    (0xD3AA1A97, of_the_fix(false, First, 0), 0), // prefer-object-has-own useHasOwn
    (0xD3CC24A7, One(488), 0), // no-misleading-character-class zwj
    (0xD3E94999, One(538), 0), // no-page-custom-font
    (0xD3FDEBA0, One(206), 0), // jsx-no-jsx-as-prop
    (0xD40EEE3E, One(907), 0), // valid-title
    (0xD439F657, Three(254), 0), // no-anonymous-default-export
    (0xD49AB8F2, One(157), 0), // exports-last
    (0xD49EBEE9, Three(108), 0), // constructor-super badSuper
    (0xD4AAB97B, One(694), 0), // number-literal-case
    (0xD513A642, One(316), 0), // no-console-spaces
    (0xD5BEDB50, One(815), 0), // prefer-to-be-object
    (0xD6C0B474, One(594), 0), // no-ternary noTernaryOperator
    (0xD6C97C3E, of_the_fix(true, First, 0), 0), // jsx-no-useless-fragment
    (0xD70F0A96, One(627), 0), // no-unnecessary-array-flat-depth
    (0xD885CC19, One(206), 0), // jsx-no-new-array-as-prop
    (0xD899622F, One(559), 0), // no-restricted-exports restrictedDefault
    (0xD8B5E5F7, One(782), 0), // prefer-module
    (0xD8F65EC5, One(70), 1), // consistent-assert
    (0xD8FE53AF, One(860), 0), // sort-vars sortVars
    (0xD90EF359, One(380), 1), // no-empty unexpected
    (0xD90F5410, One(796), 0), // prefer-query-selector
    (0xD9416D6B, One(468), 0), // no-lonely-if
    (0xD950E53F, One(322), 1), // no-constant-binary-expression constantBinaryOperand
    (0xD9B7948F, One(788), 0), // prefer-negative-index
    (0xDA31B749, One(729), 0), // prefer-date-now
    (0xDA5D85E6, One(808), 0), // prefer-strict-boolean-matchers
    (0xDAD8A3E8, One(505), 0), // no-namespace moduleSyntaxIsPreferred
    (0xDB10F975, Three(240), 0), // new-cap upper
    (0xDB48F444, One(33), 0), // bad-char-at-comparison
    (0xDB54409C, One(190), 0), // img-redundant-alt
    (0xDB81EC87, One(281), 0), // no-base-to-string baseToString
    (0xDBB6158F, One(171), 0), // getter-return expected
    (0xDC61091E, One(185), 0), // html-has-lang
    (0xDC68306F, One(332), 0), // no-danger
    (0xDC7EB91E, Three(461), 2), // no-label-var identifierClashWithLabel
    (0xDCC5E572, One(670), 0), // no-useless-default-assignment uselessDefaultAssignment
    (0xDCEEC554, One(898), 0), // valid-expect
    (0xDDF7FF7A, One(297), 0), // no-cond-assign missing
    (0xDE3B446F, One(469), 0), // no-lonely-if unexpectedLonelyIf
    (0xDE487B04, One(399), 0), // no-extra-boolean-cast unexpectedNegation
    (0xDE9B852F, One(499), 1), // no-mutable-exports
    (0xDF3909E4, One(101), 0), // consistent-type-specifier-style
    (0xDF3EE5E7, One(412), 0), // no-floating-promises floatingPromiseArrayVoid
    (0xDF9AB5F1, Three(54), 5), // ban-types
    (0xDFFFA08C, One(414), 0), // no-floating-promises floatingUselessRejectionHandlerVoid
    (0xE03E56A7, One(558), 0), // no-require-imports noRequireImports
    (0xE044E499, One(573), 0), // no-self-import
    (0xE04FD184, One(560), 0), // no-restricted-exports restrictedNamed
    (0xE09BFF21, Three(195), 0), // jsx-curly-brace-presence
    (0xE09D0B18, One(388), 1), // no-eq-null unexpected
    (0xE0D8226F, Three(344), 0), // no-document-cookie
    (0xE0EBE6D3, One(650), 0), // no-unsafe-type-assertion unsafeToAnyTypeAssertion
    (0xE14757CE, Three(607), 0), // no-top-level-await
    (0xE19777DE, One(383), 1), // no-empty-function unexpected
    (0xE199E5B5, One(729), 0), // prefer-date-now
    (0xE1DEC7FC, One(865), 0), // strict-boolean-expressions conditionErrorNullableString
    (0xE206BD3B, One(772), 0), // prefer-import-meta-properties
    (0xE2277A53, One(244), 0), // no-absolute-path
    (0xE306EC1A, One(494), 0), // no-misused-spread noStringSpread
    (0xE47FB7DA, One(470), 0), // no-loop-func unsafeRefs
    (0xE498E2B0, One(283), 0), // no-bitwise unexpected
    (0xE4D0D7C0, of_the_fix(false, First, 0), 0), // no-hex-escape
    (0xE4EC54A3, Three(325), 0), // no-constant-condition unexpected
    (0xE4FCAE99, One(364), 0), // no-duplicate-hooks
    (0xE50EA630, One(655), 0), // no-unwanted-polyfillio
    (0xE5685438, One(400), 1), // no-extra-label unexpected
    (0xE568A058, One(156), 0), // export
    (0xE580006E, One(805), 0), // prefer-snapshot-hint
    (0xE5EBCD1C, One(862), 0), // strict-boolean-expressions conditionErrorNullableBoolean
    (0xE706377D, One(665), 0), // no-useless-concat unexpectedConcat
    (0xE777912D, One(541), 0), // no-path-concat
    (0xE8EE39F8, One(562), 1), // no-restricted-imports importNameWithCustomMessage
    (0xE92A065A, of_the_fix(false, First, 0), 0), // prefer-todo
    (0xE971B765, One(708), 0), // prefer-array-some
    (0xE97E09AF, One(342), 1), // no-distracting-elements
    (0xE99D5267, One(642), 0), // no-unsafe-enum-comparison mismatchedCase
    (0xE9B56B33, One(486), 0), // no-misleading-character-class surrogatePair
    (0xE9C50A93, One(603), 0), // no-this-in-exported-function
    (0xE9E29A8C, One(768), 1), // prefer-hooks-in-order
    (0xEA3192AA, One(165), 0), // for-direction incorrectDirection
    (0xEAB591FB, One(780), 1), // prefer-mock-promise-shorthand
    (0xEB77512C, One(18), 1), // array-callback-return expectedInside
    (0xEBC3515F, One(93), 0), // consistent-type-exports typeOverValue
    (0xEBF16DC2, One(826), 0), // radix missingRadix
    (0xEC2D5854, One(531), 0), // no-noninteractive-element-to-interactive-role
    (0xEC613EF3, One(333), 0), // no-danger-with-children
    (0xEC763356, One(298), 0), // no-conditional-expect
    (0xED78762F, One(899), 0), // valid-expect
    (0xEDA48D4E, One(863), 0), // strict-boolean-expressions conditionErrorNullableEnum
    (0xEDC9825F, One(588), 0), // no-static-only-class
    (0xEE1F5A6E, Three(96), 0), // consistent-type-imports typeOverValue
    (0xEE58986E, One(260), 0), // no-array-fill-with-reference-type
    (0xEE6047E3, One(436), 0), // no-immediate-mutation
    (0xEF52F1E4, One(347), 0), // no-document-import-in-page
    (0xEF897DAB, One(164), 0), // first
    (0xEFC0F404, One(562), 1), // no-restricted-imports allowedImportNamePatternWithCustomMessage
    (0xEFE0EF94, One(92), 1), // consistent-type-exports singleExportIsType
    (0xEFEBFAA9, One(404), 0), // no-extraneous-class empty
    (0xF066073E, One(94), 0), // consistent-type-imports avoidImportType
    (0xF156010E, Three(304), 0), // no-confusing-array-with
    (0xF1746AFD, One(429), 0), // no-identical-title
    (0xF1896FC1, One(853), 1), // restrict-plus-operands invalid
    (0xF192F5C4, One(687), 0), // no-will-update-set-state
    (0xF1A58E09, One(449), 0), // no-inline-comments unexpectedInlineComment
    (0xF1EB9AE8, One(341), 0), // no-disabled-tests
    (0xF2BC9BE9, One(60), 0), // button-has-type
    (0xF3BF69FE, Three(371), 0), // no-duplicate-imports importAs
    (0xF43B393B, Three(765), 0), // prefer-global-this
    (0xF486CAA1, One(213), 0), // jsx-props-no-spread-multi
    (0xF4B54969, Three(360), 3), // no-duplicate-enum-values duplicateValue
    (0xF4D295B7, One(828), 0), // relative-url-style
    (0xF4DDFB84, One(321), 0), // no-constant-binary-expression bothAlwaysNew
    (0xF53870F8, One(822), 0), // preserve-caught-error missingCatchErrorParam
    (0xF5A9748D, One(385), 0), // no-empty-interface noEmptyWithSuper
    (0xF61463C0, Three(880), 0), // unified-signatures omittingSingleParameter
    (0xF6C8740D, One(16), 1), // aria-activedescendant-has-tabindex
    (0xF6C8D03B, One(585), 0), // no-sparse-arrays unexpectedSparseArray
    (0xF82A7365, One(674), 0), // no-useless-iterator-to-array
    (0xF834DBE7, One(649), 0), // no-unsafe-type-assertion unsafeOfAnyTypeAssertion
    (0xF84112AB, One(287), 0), // no-children-prop
    (0xF894B5A4, One(145), 0), // exhaustive-deps
    (0xF95AFE11, One(569), 0), // no-script-component-in-head
    (0xF99C9D8A, One(900), 0), // valid-expect
    (0xF9B34A33, One(562), 1), // no-restricted-imports allowedImportNameWithCustomMessage
    (0xFA73A165, One(521), 0), // no-new-wrappers noConstructor
    (0xFACAC847, of_the_fix(false, First, 0), 0), // prefer-modern-dom-apis
    (0xFB27139E, One(783), 0), // prefer-module
    (0xFB660D51, One(908), 0), // valid-title
    (0xFC42BC7F, One(437), 0), // no-immediate-mutation
    (0xFC4F3444, of_the_fix(false, All, 0), 0), // array-type errorStringArraySimple
    (0xFC854321, One(852), 0), // require-yield missingYield
    (0xFCA1907E, One(829), 0), // relative-url-style
    (0xFCD64168, One(192), 0), // inline-script-id
    (0xFD4B6DE8, One(726), 1), // prefer-code-point
    (0xFD7379FB, One(728), 0), // prefer-const useConst
    (0xFE0C8B6D, One(203), 0), // jsx-key
    (0xFE1699D3, One(553), 0), // no-redeclare redeclaredAsBuiltin
    (0xFE9DD28C, One(233), 0), // mouse-events-have-key-events
    (0xFEB93DCB, One(695), 1), // number-literal-case
    (0xFEE4E16D, One(386), 0), // no-empty-object-type noEmptyInterface
    (0xFEFF2620, Three(83), 0), // consistent-type-assertions never
    (0xFF0B6D19, One(810), 1), // prefer-string-trim-start-end
    (0xFF135B82, One(840), 0), // require-render-return
    (0xFF321DDB, One(659), 0), // no-useless-assignment unnecessaryAssignment
    (0xFF3DA765, One(886), 0), // uninvoked-array-callback
    (0xFF4FF175, One(730), 0), // prefer-default-export
    (0xFF674826, of_the_fix(false, First, 0), 0), // jsx-boolean-value
    (0xFF73BE67, One(39), 1), // bad-object-literal-comparison
    (0xFFE6404B, of_the_fix(false, First, 0), 0), // operator-assignment unexpected
];
