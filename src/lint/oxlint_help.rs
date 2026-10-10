//! What oxlint says besides the message of a diagnostic: its `help`, its `note`, and what it says at the place.
//!
//! Made from what oxlint 1.87 prints for the cases of the test suites, each paired with what `bun lint` reports at the same place: an
//! entry is the text of oxlint in which the values that the rule gives to [`Report::data`](crate::context::Report::data) are
//! replaced by their names, if that makes the text of all the pairs with that message, letter for letter.

use crate::rule::{Message, Meta};
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
    pub(crate) fn found(self, part: Part) -> Found {
        let entry = self.0.get();
        let entry = match (entry & MORE, part, ROWS.get((entry & 0xFFF) as usize)) {
            (0, Part::Help, _) => entry,
            (0, ..) | (.., None) => 0,
            (_, Part::Help, Some(row)) => row.help,
            (_, Part::FirstLabel, Some(row)) => row.first_label,
            (_, Part::Note, Some(row)) => row.note,
        };
        if entry & OF_THE_FIX != 0 {
            return Found::OfTheFix {
                removes: entry & 1 != 0,
                edits: if entry & 2 == 0 {
                    Edits::First
                } else {
                    Edits::All
                },
            };
        }
        let (start, len) = (entry >> 12 & 0x1FFFF, entry & 0xFFF);
        let text = TEXT.get(start as usize..(start + len) as usize);
        match (text, entry & WITH_DATA) {
            (None | Some(""), _) => Found::Nothing,
            (Some(text), 0) => Found::Constant(text),
            (Some(text), _) => Found::WithData(text),
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
        self.0.get() & WITH_DATA != 0
    }

    /// The help is [`Found::OfTheFix`].
    pub(crate) fn is_of_the_fix(self) -> bool {
        self.0.get() & OF_THE_FIX != 0
    }
}

/// What there is for `message`, which is as oxlint says it, of `rule`.
pub(crate) fn of(rule: &Meta, message: Message) -> Option<Help> {
    let key = rule.key ^ message.key.rotate_left(16);
    let at = INDEX.binary_search_by_key(&key, |it| it.0).ok()?;
    NonZeroU32::new(INDEX.get(at)?.1).map(Help)
}

/// The entry is a row of [`ROWS`], with the bits [`WITH_DATA`] and [`OF_THE_FIX`] of all that is in the row.
const MORE: u32 = 1 << 29;
const WITH_DATA: u32 = 1 << 30;
const OF_THE_FIX: u32 = 1 << 31;

const fn at(start: u32, len: u32) -> u32 {
    start << 12 | len
}

const fn more(row: u32) -> u32 {
    MORE | row
}

/// Each as an entry of [`INDEX`] that is a help. 0: there is none.
struct Row {
    help: u32,
    first_label: u32,
    note: u32,
}

/// Sorted by the key, which is made of `Meta::key` and `Message::key`. Then where the help starts in [`TEXT`], and its length.
#[rustfmt::skip]
static INDEX: &[(u32, u32)] = &[
    (0x0060F26E, at(46990, 67)), // no-unsafe-function-type bannedFunctionType
    (0x00794F6C, OF_THE_FIX), // prefer-to-be-falsy
    (0x0080189E, at(14126, 76)), // func-name-matching matchProperty
    (0x009D1FB0, at(48362, 71)), // no-useless-computed-key unnecessarilyComputedProperty
    (0x00B328BB, more(0)), // prefer-at
    (0x00D239E9, at(23365, 71)), // no-commonjs
    (0x00F6B325, WITH_DATA | more(1)), // no-func-assign isAFunction
    (0x0118BF96, more(2)), // no-dynamic-delete dynamicDelete
    (0x0123C577, more(3)), // default-case-last notLast
    (0x01B12D02, WITH_DATA | at(50744, 62)), // padding-around-test-blocks
    (0x01D7F018, at(19522, 55)), // next-script-for-ga
    (0x01DC3163, WITH_DATA | at(42851, 57)), // no-shadow-restricted-names shadowingRestrictedName
    (0x01E6B38E, at(60207, 42)), // require-returns-description
    (0x02275BCC, WITH_DATA | at(42783, 68)), // no-shadow noShadowGlobal
    (0x02FE0566, at(11710, 83)), // error-message
    (0x040964C8, at(62497, 36)), // unicode-bom expected
    (0x053BAE70, at(32985, 28)), // no-implied-eval noImpliedEvalError
    (0x058AAB56, at(57757, 54)), // prefer-template unexpectedStringConcatenation
    (0x05C2ED19, at(29524, 126)), // no-extend-native unexpected
    (0x061995FF, at(46384, 121)), // no-unsafe-assignment anyAssignmentThis
    (0x0687884C, at(32447, 46)), // no-immediate-mutation
    (0x06EAECE6, at(23601, 113)), // no-conditional-in-test
    (0x071D498B, at(40790, 76)), // no-promise-in-callback
    (0x07C91B4B, at(33195, 193)), // no-importing-vitest-globals
    (0x07D3DAF0, at(25293, 111)), // no-control-regex unexpected
    (0x0811C395, at(36785, 54)), // no-misused-spread noMapSpreadInObject
    (0x0858A4B1, at(44763, 74)), // no-unassigned-import
    (0x0872DEF5, at(7069, 46)), // consistent-existence-index-check
    (0x08A9ECAE, at(49426, 54)), // no-useless-undefined
    (0x08D1BD39, at(0, 33)), // accessor-pairs missingGetterInPropertyDescriptor
    (0x0905D05C, at(42166, 61)), // no-self-assign selfAssignment
    (0x091A0342, at(53148, 41)), // prefer-dom-node-text-content
    (0x092B0E10, at(50806, 75)), // parameter-properties preferClassProperty
    (0x0947BAC4, at(39929, 60)), // no-nonoctal-decimal-escape decimalEscape
    (0x09DA5F90, WITH_DATA | at(61202, 57)), // restrict-plus-operands mismatched
    (0x0A513778, more(4)), // no-anonymous-default-export
    (0x0AAD4A16, OF_THE_FIX), // sort-keys sortKeys
    (0x0AB65693, at(40678, 30)), // no-process-env
    (0x0B3AFDA4, OF_THE_FIX), // prefer-string-starts-ends-with
    (0x0B4075BA, at(30405, 101)), // no-fallthrough default
    (0x0BA721AE, at(14126, 76)), // func-name-matching matchVariable
    (0x0BD4ACB3, WITH_DATA | at(7612, 102)), // consistent-type-assertions angle-bracket
    (0x0C0D2A86, at(51942, 87)), // prefer-bigint-literals
    (0x0C2B5AB6, WITH_DATA | at(18875, 30)), // misrefactored-assign-op
    (0x0C79C256, at(17581, 53)), // jsx-no-target-blank
    (0x0C91E0A2, at(62533, 40)), // unicode-bom unexpected
    (0x0CAEE6D8, at(42351, 91)), // no-sequences unexpectedCommaExpression
    (0x0CC03201, WITH_DATA | more(5)), // prefer-enum-initializers defineInitializer
    (0x0CFAB60A, OF_THE_FIX), // prefer-includes
    (0x0D14EA50, at(16987, 65)), // jsx-no-duplicate-props
    (0x0D7DC07F, at(16354, 59)), // jsx-fragments
    (0x0D8D8E11, at(58418, 130)), // promise-function-async missingAsyncHybridReturn
    (0x0E0355F8, WITH_DATA | at(6344, 58)), // check-property-names
    (0x0E05869C, at(62755, 47)), // use-isnan switchNaN
    (0x0E386427, at(28617, 171)), // no-eval unexpected
    (0x0E538FD3, WITH_DATA | at(34224, 35)), // no-jasmine-globals
    (0x0E83665F, at(17780, 226)), // label-has-associated-control
    (0x0E927D39, at(30405, 101)), // no-fallthrough case
    (0x0F2D3BB6, at(61084, 41)), // require-yields-description
    (0x0F38A7FF, at(29650, 24)), // no-extra-bind unexpected
    (0x0F58F8C1, at(46384, 121)), // no-unsafe-call unsafeCallThis
    (0x0FD049B8, at(38231, 83)), // no-nested-ternary noNestedTernary
    (0x0FF43A4D, at(41362, 87)), // no-relative-parent-imports
    (0x10142F89, at(58266, 82)), // preserve-caught-error partiallyLostError
    (0x101D918F, WITH_DATA | more(6)), // no-class-assign class
    (0x105BB692, at(25739, 48)), // no-default-export
    (0x106D3C17, at(13206, 90)), // explicit-member-accessibility unwantedPublicAccessibility
    (0x108B4503, at(32847, 51)), // no-implicit-globals globalVariableLeak
    (0x10EC629D, OF_THE_FIX), // prefer-to-be
    (0x10FCE172, more(7)), // prefer-function-component
    (0x1140A6BB, at(54173, 60)), // prefer-expect-assertions
    (0x116D0C7B, OF_THE_FIX), // prefer-to-be
    (0x11DDDB46, at(34184, 40)), // no-iterator noIterator
    (0x1237F276, at(759, 110)), // alt-text
    (0x12425C48, at(11214, 46)), // display-name
    (0x124AB7BF, at(14754, 61)), // grouped-accessor-pairs notGrouped
    (0x12D3E40B, at(21071, 72)), // no-arrow-functions-in-watch
    (0x12D67E80, OF_THE_FIX), // prefer-string-slice
    (0x131E6446, at(573, 92)), // alt-text
    (0x1331A7D3, at(48947, 134)), // no-useless-promise-resolve-reject
    (0x13B134F0, more(8)), // constructor-super duplicate
    (0x144B9C52, at(0, 33)), // accessor-pairs missingGetterInClass
    (0x144D600D, OF_THE_FIX), // prefer-to-be-truthy
    (0x1481816A, WITH_DATA | at(10290, 86)), // const-comparisons
    (0x14BA2452, at(33013, 30)), // no-import-assign readonlyMember
    (0x14C236C5, at(50980, 166)), // prefer-add-event-listener
    (0x153734AE, at(14476, 56)), // google-font-display
    (0x155E8E4F, at(60421, 47)), // require-test-timeout
    (0x1582E15B, at(31952, 63)), // no-head-import-in-document
    (0x15F11F3B, at(13378, 51)), // explicit-module-boundary-types missingArgTypeUnnamed
    (0x1600E77C, at(47937, 140)), // no-useless-backreference backward
    (0x162D2C2C, WITH_DATA | at(6402, 71)), // check-property-names
    (0x162E6ADB, at(13763, 29)), // exports-style
    (0x16A58B57, at(19642, 38)), // no-abusive-eslint-disable
    (0x16C210C0, at(18255, 45)), // max-statements exceed
    (0x16FCD447, at(17546, 35)), // jsx-no-target-blank
    (0x1716694C, at(51715, 122)), // prefer-await-to-callbacks
    (0x17DA8860, at(33491, 132)), // no-instanceof-array
    (0x18610854, OF_THE_FIX), // prefer-to-contain
    (0x187F550D, OF_THE_FIX | 2), // array-type errorStringGeneric
    (0x18A66ABB, at(40731, 59)), // no-promise-executor-return returnsValue
    (0x1905F47D, at(46384, 121)), // no-unsafe-call errorCallThis
    (0x193E14CD, more(9)), // no-anonymous-default-export
    (0x193FD901, at(665, 94)), // alt-text
    (0x19959635, at(32717, 33)), // no-implicit-globals globalLexicalBinding
    (0x19B15CBB, at(20766, 46)), // no-array-reduce
    (0x1A128CDC, at(38314, 55)), // no-nesting
    (0x1A840B64, at(34667, 44)), // no-lone-blocks redundantNestedBlock
    (0x1A9B3FED, at(38671, 78)), // no-new-buffer
    (0x1A9EEA9F, at(43013, 58)), // no-standalone-expect
    (0x1AB19EE9, at(50516, 78)), // numeric-separators-style
    (0x1AB2D2B4, WITH_DATA | at(44923, 130)), // no-undef undef
    (0x1B0CC963, more(10)), // prefer-namespace-keyword useNamespace
    (0x1B3387A4, at(26121, 113)), // no-did-mount-set-state
    (0x1B56DF94, at(47423, 45)), // no-unused-expressions unusedExpression
    (0x1BB099A0, at(50682, 62)), // padding-around-after-all-blocks
    (0x1BD891E7, WITH_DATA | at(37534, 113)), // no-named-as-default
    (0x1C50F8CB, at(14126, 76)), // func-name-matching notMatchVariable
    (0x1CB82C2D, at(2026, 57)), // arrow-body-style unexpectedObjectBlock
    (0x1D322BFB, at(58230, 36)), // prefer-type-error
    (0x1D83871A, at(33956, 94)), // no-invalid-void-type invalidVoidNotReturnOrThisParam
    (0x1E244682, more(11)), // prefer-event-target
    (0x1E4D2974, at(43633, 112)), // no-thenable
    (0x1EEBBE80, at(52029, 74)), // prefer-called-exactly-once-with
    (0x1F7FDA40, at(25293, 111)), // no-control-regex unexpected
    (0x1F90CE4A, at(21774, 99)), // no-await-expression-member
    (0x1FAC619A, at(31620, 75)), // no-for-in-array forInViolation
    (0x20D05EE5, at(55424, 46)), // prefer-literal-enum-member notLiteral
    (0x21748555, at(54469, 39)), // prefer-exponentiation-operator useExponentiation
    (0x2181B206, more(12)), // unified-signatures singleParameterDifference
    (0x2205CF93, at(62802, 45)), // use-isnan comparisonWithNaN
    (0x226B3AAC, at(38369, 70)), // no-new noNewStatement
    (0x22B2BA85, at(28417, 106)), // no-empty-object-type noEmptyInterfaceWithSuper
    (0x24487926, WITH_DATA | at(59034, 49)), // require-awaited-expect-poll
    (0x244A0CCB, at(45689, 63)), // no-unnecessary-array-splice-count
    (0x2481EB1F, at(57103, 53)), // prefer-rest-params preferRestParams
    (0x248A8A81, WITH_DATA | at(26024, 48)), // no-deprecated-destroyed-lifecycle
    (0x24AD54E2, at(25989, 35)), // no-deprecated-data-object-declaration
    (0x24E68FCA, OF_THE_FIX), // prefer-to-be
    (0x250F790D, WITH_DATA | at(7537, 75)), // consistent-test-it
    (0x25AAA242, at(47937, 140)), // no-useless-backreference nested
    (0x25ADCBD5, at(14815, 107)), // guard-for-in wrap
    (0x25AF89B7, at(38439, 232)), // no-new-array
    (0x25B6FA93, more(13)), // no-async-endpoint-handlers
    (0x25EE7DEF, at(46788, 120)), // no-unsafe-enum-comparison mismatchedCondition
    (0x2602EF24, at(42012, 56)), // no-return-wrap
    (0x266406B4, OF_THE_FIX), // text-encoding-identifier-case
    (0x2692F915, at(17546, 35)), // jsx-no-target-blank
    (0x26B202C5, at(26589, 24)), // no-div-regex unexpected
    (0x26F06D05, at(22618, 82)), // no-before-interactive-script-outside-document
    (0x26FFE9DE, at(5834, 74)), // branches-sharing-code
    (0x279AAA40, at(12928, 47)), // exhaustive-deps
    (0x27F9437A, at(5834, 74)), // branches-sharing-code
    (0x28285BAA, WITH_DATA | more(14)), // no-barrel-file
    (0x287E3094, WITH_DATA | at(19861, 72)), // no-accessor-recursion
    (0x28AF844A, at(14126, 76)), // func-name-matching notMatchProperty
    (0x28B8D6A6, WITH_DATA | at(39083, 59)), // no-new-native-nonconstructor noNewNonconstructor
    (0x28EF0ABD, at(62028, 43)), // symbol-description expected
    (0x28F15987, OF_THE_FIX), // prefer-to-be
    (0x2905BD12, at(13996, 42)), // first
    (0x2914DD32, OF_THE_FIX), // no-blank-blocks
    (0x2936D5DD, at(33013, 30)), // no-import-assign readonly
    (0x294AC64D, at(43963, 64)), // no-this-assignment
    (0x29E0C363, at(54534, 59)), // prefer-for-of preferForOf
    (0x2A0567C6, WITH_DATA | at(32652, 65)), // no-immediate-mutation
    (0x2A194A9C, at(29389, 135)), // no-expose-after-await
    (0x2A383EE8, WITH_DATA | at(2679, 195)), // bad-array-method-on-arguments
    (0x2A40F8AD, WITH_DATA | at(10462, 60)), // const-comparisons
    (0x2A64055F, WITH_DATA | more(15)), // no-dupe-class-members unexpected
    (0x2AB32820, WITH_DATA | at(869, 104)), // anchor-ambiguous-text
    (0x2B1406AF, more(16)), // no-duplicate-imports export
    (0x2B87867E, more(17)), // unified-signatures allParametersAreSame
    (0x2C48190F, OF_THE_FIX), // no-useless-escape unnecessaryEscape
    (0x2D0C060F, at(16133, 68)), // interactive-supports-focus
    (0x2D97980B, at(60468, 57)), // require-test-timeout
    (0x2D97C338, at(2228, 120)), // await-thenable await
    (0x2DB8429D, at(54022, 45)), // prefer-expect-assertions
    (0x2E0DDD90, at(17508, 38)), // jsx-no-script-url
    (0x2EBC678D, at(37415, 56)), // no-multiple-slot-args
    (0x2EC5DBD1, more(18)), // consistent-type-assertions unexpectedObjectTypeAssertion
    (0x2F10E46A, at(16021, 59)), // init-declarations notInitialized
    (0x2F2BBEA6, at(49877, 32)), // no-with unexpectedWith
    (0x2F4F170A, at(23714, 36)), // no-conditional-tests
    (0x2F8E0659, at(6631, 50)), // class-literal-property-style preferGetterStyle
    (0x2FD0D405, WITH_DATA | at(61388, 48)), // role-supports-aria-props
    (0x302217C2, OF_THE_FIX), // prefer-to-be
    (0x305AA56F, WITH_DATA | at(55568, 54)), // prefer-mock-return-shorthand
    (0x30A935DC, WITH_DATA | at(7487, 50)), // consistent-test-filename
    (0x30DA2BE4, WITH_DATA | at(2083, 62)), // autocomplete-valid
    (0x30F77694, at(18255, 45)), // max-lines-per-function exceed
    (0x31064F33, at(63428, 30)), // valid-expect
    (0x313E1D6C, at(21231, 63)), // no-async-client-component
    (0x31815129, at(24615, 175)), // no-const-enum
    (0x323049FB, at(46505, 153)), // no-unsafe-declaration-merging unsafeMerging
    (0x32A4602D, at(62963, 52)), // valid-define-emits
    (0x32F34167, WITH_DATA | at(56264, 53)), // prefer-node-protocol
    (0x331EE56D, at(1909, 63)), // arrow-body-style expectedBlock
    (0x338A21D2, OF_THE_FIX), // prefer-to-have-length
    (0x33ADF728, at(57156, 15)), // prefer-set-has
    (0x345D4F08, at(11176, 38)), // default-param-last shouldBeLast
    (0x3491E50F, at(2450, 101)), // await-thenable forAwaitOfNonAsyncIterable
    (0x35A40854, at(28247, 80)), // no-empty-interface noEmpty
    (0x367988B3, at(25837, 152)), // no-delete-var unexpected
    (0x372F35A2, at(51597, 29)), // prefer-at
    (0x37356D1D, at(57454, 50)), // prefer-spread preferSpread
    (0x37359BE4, WITH_DATA | at(52905, 60)), // prefer-destructuring preferDestructuring
    (0x37441D54, at(61045, 39)), // require-yields
    (0x37A179DC, at(59364, 146)), // require-number-to-fixed-digits-argument
    (0x38375F1D, more(19)), // no-react-children
    (0x38AA9EA3, at(58820, 111)), // react-in-jsx-scope
    (0x38F375BE, at(14984, 69)), // heading-has-content
    (0x39372F2F, at(0, 33)), // accessor-pairs missingGetterInObjectLiteral
    (0x39763B2A, WITH_DATA | at(11553, 36)), // eqeqeq unexpected
    (0x39B8CC08, at(51371, 96)), // prefer-array-index-of
    (0x39DAC322, at(63301, 39)), // valid-describe-callback
    (0x3A0B6013, at(11393, 119)), // empty-brace-spaces
    (0x3A63C3F6, at(14202, 44)), // func-names named
    (0x3A6CD864, at(21679, 62)), // no-async-promise-executor async
    (0x3A9AE125, WITH_DATA | at(41746, 17)), // no-restricted-imports patternAndImportNameWithCustomMessage
    (0x3B71AA53, WITH_DATA | at(50145, 41)), // no-zero-fractions
    (0x3BC6501C, at(12674, 34)), // exhaustive-deps
    (0x3C576391, WITH_DATA | at(64404, 68)), // yoda expected
    (0x3C80759E, at(23335, 30)), // no-commented-out-tests
    (0x3CD49CEB, at(50881, 99)), // parameter-properties preferParameterProperty
    (0x3D523E1C, at(42975, 38)), // no-sparse-arrays unexpectedSparseArray
    (0x3D84DFFA, at(41449, 43)), // no-render-return-value
    (0x3D891842, WITH_DATA | at(1214, 38)), // aria-unsupported-elements
    (0x3DFD522C, at(57034, 69)), // prefer-response-static-json
    (0x3E23022F, at(13378, 51)), // explicit-module-boundary-types missingArgType
    (0x3F702622, at(13296, 82)), // explicit-module-boundary-types anyTypedArgUnnamed
    (0x3FD5EFB3, at(13296, 82)), // explicit-module-boundary-types anyTypedArg
    (0x4037A6A1, at(54508, 26)), // prefer-export-from
    (0x403D7235, at(36225, 155)), // no-misleading-character-class regionalIndicatorSymbol
    (0x40451C31, at(34351, 63)), // no-labels unexpectedLabel
    (0x406EC540, OF_THE_FIX), // prefer-optional-catch-binding
    (0x40C9F62F, WITH_DATA | at(41774, 8)), // no-restricted-properties restrictedProperty
    (0x40CE6680, at(13429, 48)), // explicit-module-boundary-types missingReturnType
    (0x412B54E4, at(52710, 23)), // prefer-default-export
    (0x4144820D, at(29674, 66)), // no-extra-boolean-cast unexpectedCall
    (0x414AD720, more(20)), // no-accumulating-spread loopSpread
    (0x41AC451D, at(31439, 158)), // no-floating-promises floatingVoid
    (0x41D3B241, at(47937, 140)), // no-useless-backreference forward
    (0x41FB84E2, at(37243, 39)), // no-multi-comp
    (0x42361FBE, at(47937, 140)), // no-useless-backreference intoNegativeLookaround
    (0x427DA840, at(33115, 80)), // no-import-type-side-effects useTopLevelQualifier
    (0x427F318F, at(45814, 47)), // no-unnecessary-slice-end
    (0x42A5A57F, at(16316, 38)), // jsx-filename-extension
    (0x4330D24B, at(0, 33)), // accessor-pairs missingGetterInType
    (0x434A3BA3, at(33, 33)), // accessor-pairs missingSetterInType
    (0x43773440, at(40346, 86)), // no-param-reassign assignmentToFunctionParam
    (0x442E57AD, at(33956, 94)), // no-invalid-void-type invalidVoidNotReturn
    (0x44DE9770, WITH_DATA | at(5725, 109)), // block-scoped-var outOfScope
    (0x44E6FF10, more(21)), // unified-signatures omittingRestParameter
    (0x450297EB, at(41126, 66)), // no-redeclare redeclared
    (0x4576BB38, at(9866, 72)), // consistent-type-specifier-style
    (0x45E80181, at(16201, 84)), // interactive-supports-focus
    (0x467B6DF5, more(22)), // no-duplicate-case unexpected
    (0x46896AB1, more(23)), // no-accumulating-spread reduceSpread
    (0x4694688D, at(36623, 76)), // no-misused-new errorMessageClass
    (0x46BABB14, WITH_DATA | at(41329, 33)), // no-regex-spaces multipleSpaces
    (0x47001535, WITH_DATA | at(56358, 40)), // prefer-number-properties
    (0x470199BD, at(41954, 58)), // no-return-wrap
    (0x470CFC81, at(52137, 91)), // prefer-called-times
    (0x471B73CB, at(56875, 22)), // prefer-readonly preferReadonly
    (0x47AD07A4, more(24)), // no-unexpected-multiline division
    (0x4905AD5B, OF_THE_FIX | 2), // consistent-type-definitions typeOverInterface
    (0x492CC0DB, at(13620, 75)), // export
    (0x4937801E, WITH_DATA | at(50186, 103)), // number-arg-out-of-range
    (0x49BD2FA0, at(36749, 36)), // no-misused-spread noFunctionSpreadInObject
    (0x49E9C313, at(43633, 112)), // no-thenable
    (0x49EA0B99, at(49223, 65)), // no-useless-rename unnecessarilyRenamed
    (0x4ADFEF5E, at(26454, 21)), // no-disabled-tests
    (0x4AE7B876, WITH_DATA | at(6984, 85)), // consistent-each-for
    (0x4B164347, at(49288, 41)), // no-useless-return unnecessaryReturn
    (0x4BA3B55F, at(49725, 53)), // no-webpack-loader-syntax
    (0x4BD8F9C6, at(15257, 97)), // hook-use-state
    (0x4BF1674B, more(25)), // bad-match-all-arg
    (0x4C73543E, at(32750, 97)), // no-implicit-globals globalNonLexicalBinding
    (0x4C8838ED, at(51544, 53)), // prefer-as-const preferConstAssertion
    (0x4CAC9F7A, at(25710, 29)), // no-debugger unexpected
    (0x4CC7D5D8, at(51324, 47)), // prefer-array-flat-map
    (0x4CD9641B, at(62122, 55)), // throw-new-error
    (0x4CFCA4DC, at(1972, 54)), // arrow-body-style unexpectedEmptyBlock
    (0x4CFFC774, OF_THE_FIX), // no-deprecated-functions
    (0x4D020C34, at(53247, 74)), // prefer-ending-with-an-expect
    (0x4D9BF559, more(26)), // no-anonymous-default-export
    (0x4DA2D1D3, at(58036, 86)), // prefer-to-have-been-called-times
    (0x4DCA515A, WITH_DATA | at(45861, 50)), // no-unnecessary-type-constraint unnecessaryConstraint
    (0x4DF5D5D7, at(18300, 54)), // max-nested-callbacks exceed
    (0x4E109504, more(27)), // require-unicode-regexp requireUFlag
    (0x4E226EF4, OF_THE_FIX), // escape-case
    (0x4E99BC4E, at(20229, 94)), // no-aria-hidden-on-focusable
    (0x4E9DB508, more(28)), // no-async-endpoint-handlers
    (0x4EF6DB9D, at(18045, 41)), // max-classes-per-file maximumExceeded
    (0x501D6803, at(63428, 30)), // valid-expect
    (0x50755686, at(29168, 97)), // no-explicit-any unexpectedAny
    (0x50F2970D, at(47572, 214)), // no-unwanted-polyfillio
    (0x50FFD073, at(43397, 52)), // no-sync-scripts
    (0x51203CCD, at(14126, 76)), // func-name-matching notMatchProperty
    (0x516ED453, at(34088, 96)), // no-is-mounted
    (0x51D00F97, at(15984, 37)), // implements-on-classes
    (0x51D024C7, at(48118, 103)), // no-useless-catch unnecessaryCatch
    (0x521DF4D2, at(6031, 72)), // callback-return
    (0x52347A5F, at(14294, 97)), // func-style expression
    (0x52821B9E, more(29)), // no-test-return-statement
    (0x52A4DF84, at(11589, 121)), // erasing-op
    (0x52AF321E, at(62755, 47)), // use-isnan caseNaN
    (0x52B28245, OF_THE_FIX), // curly unexpectedCurlyAfter
    (0x52BC8235, at(64315, 89)), // warn-todo
    (0x53091EDD, WITH_DATA | at(11304, 89)), // double-comparisons
    (0x531E3EC8, at(47937, 140)), // no-useless-backreference disjunctive
    (0x5354B870, at(49480, 29)), // no-var unexpectedVar
    (0x5368BAFF, at(61125, 28)), // require-yields-type
    (0x5398EA92, at(58266, 82)), // preserve-caught-error caughtErrorShadowed
    (0x53A1C515, at(57624, 33)), // prefer-structured-clone
    (0x53D9403E, at(35332, 35)), // no-magic-array-flat-depth
    (0x53FB4E46, at(30820, 85)), // no-floating-promises floatingPromiseArray
    (0x548F0D63, at(41626, 25)), // no-restricted-exports restrictedDefault
    (0x54B14656, at(7187, 43)), // consistent-generic-constructors preferConstructor
    (0x54CBEA1A, at(59345, 19)), // require-module-specifiers
    (0x5557B33E, more(30)), // no-anonymous-default-export
    (0x556EEF87, at(12628, 46)), // exhaustive-deps
    (0x559A3AAA, WITH_DATA | at(1740, 169)), // array-callback-return mayReachEndOfIf
    (0x5646286A, at(35968, 118)), // no-misleading-character-class combiningClass
    (0x568E64EB, more(31)), // bad-replace-all-arg
    (0x56D50D2B, at(33043, 43)), // no-import-compiler-macros
    (0x56D7811F, at(24143, 37)), // no-confusing-void-expression invalidVoidExpr
    (0x56E93E46, at(33956, 94)), // no-invalid-void-type invalidVoidNotReturnOrGeneric
    (0x5782557A, at(14081, 45)), // forward-ref-uses-ref
    (0x58A466ED, at(11114, 21)), // default-case missingDefaultCase
    (0x58DA34B4, at(18658, 82)), // media-has-caption
    (0x590E840B, OF_THE_FIX), // prefer-spy-on
    (0x593BD524, at(43245, 39)), // no-string-refs
    (0x59B22FBB, at(20001, 23)), // no-alert unexpected
    (0x59F21520, WITH_DATA | at(52103, 34)), // prefer-called-once
    (0x5A2BB6EF, at(48221, 141)), // no-useless-catch unnecessaryCatchClause
    (0x5A2D5611, at(33956, 94)), // no-invalid-void-type invalidVoidForGeneric
    (0x5A60BB58, OF_THE_FIX), // no-useless-collection-argument
    (0x5A80AFB1, at(58548, 97)), // radix invalidRadix
    (0x5A9E7553, at(36456, 25)), // no-misleading-character-class surrogatePairWithoutUFlag
    (0x5AF1595D, at(14294, 97)), // func-style declaration
    (0x5B734369, WITH_DATA | at(37647, 82)), // no-named-as-default-member
    (0x5BC28272, at(59916, 60)), // require-render-return
    (0x5BEE2655, at(32538, 43)), // no-immediate-mutation
    (0x5C900B00, at(49509, 52)), // no-var-requires noVarReqs
    (0x5CC6FCF8, WITH_DATA | at(38024, 96)), // no-negation-in-equality-check
    (0x5D0F92E9, at(35367, 95)), // no-magic-numbers noMagic
    (0x5D441852, at(33861, 42)), // no-interpolation-in-snapshots
    (0x5D7B2CB9, WITH_DATA | at(18228, 27)), // max-lines exceed
    (0x5DB5EA2F, at(59083, 81)), // require-direct-export
    (0x5DB72799, at(48665, 25)), // no-useless-empty-export uselessExport
    (0x5E3E5C10, at(49329, 38)), // no-useless-spread
    (0x5E7E7B07, at(36699, 50)), // no-misused-new errorMessageInterface
    (0x5E7FBF0E, WITH_DATA | more(32)), // no-shadow noShadow
    (0x5E808371, at(493, 80)), // alt-text
    (0x5E9582B5, at(42227, 70)), // no-self-compare comparingToSelf
    (0x5E98BF1B, WITH_DATA | at(54233, 60)), // prefer-expect-assertions
    (0x5E9FBEEF, at(26234, 114)), // no-did-update-set-state
    (0x5EC9566A, OF_THE_FIX), // valid-next-tick
    (0x5ED5EA27, at(44027, 53)), // no-this-before-super noBeforeSuper
    (0x5EF87FAD, at(43745, 137)), // no-this-alias thisAssignment
    (0x5EFB52AD, at(32898, 39)), // no-implied-eval execScript
    (0x5F1AAC0D, more(33)), // no-new-func noFunctionConstructor
    (0x5F289D03, at(63061, 53)), // valid-define-props
    (0x5FC22DE6, at(63657, 87)), // valid-expect-in-promise
    (0x60274EAA, at(13792, 22)), // exports-style
    (0x6050AC87, OF_THE_FIX | 2), // array-type errorStringArray
    (0x6064B3C1, at(45911, 64)), // no-unneeded-async-expect-function
    (0x60775FC2, at(63015, 46)), // valid-define-emits
    (0x608038F2, at(59569, 33)), // require-param-description
    (0x6099C903, WITH_DATA | more(34)), // adjacent-overload-signatures adjacentSignature
    (0x6131F82C, at(60590, 41)), // require-throws-description
    (0x6182F6AE, at(11851, 82)), // error-message
    (0x619CF5B6, at(36086, 139)), // no-misleading-character-class emojiModifier
    (0x61C4E6B8, at(48927, 20)), // no-useless-iterator-to-array
    (0x61D610DB, at(11793, 58)), // error-message
    (0x62896888, WITH_DATA | at(1548, 192)), // array-callback-return mayFallThroughSwitch
    (0x62F126DF, at(22933, 96)), // no-case-declarations unexpected
    (0x62FB98DC, more(35)), // no-unexpected-multiline function
    (0x63289AA6, WITH_DATA | at(61319, 69)), // role-has-required-aria-props
    (0x639C39AB, at(12569, 59)), // exhaustive-deps
    (0x643A3C40, at(14436, 40)), // global-require
    (0x645CBB4B, at(20638, 128)), // no-array-method-this-argument
    (0x6490DABD, at(24213, 38)), // no-confusing-void-expression invalidVoidExprReturn
    (0x649BA4B6, at(7230, 44)), // consistent-generic-constructors preferTypeAnnotation
    (0x65D9A51E, at(56897, 59)), // prefer-reflect-apply
    (0x65E653F3, at(17634, 26)), // jsx-props-no-spread-multi
    (0x65F96EAF, WITH_DATA | at(41763, 11)), // no-restricted-matchers
    (0x6634C5A7, at(60701, 55)), // require-typed-ref
    (0x66A86706, at(2026, 57)), // arrow-body-style unexpectedSingleBlock
    (0x67B8A380, at(30595, 128)), // no-find-dom-node
    (0x67CED70F, at(18495, 82)), // max-params exceed
    (0x67D5835A, at(56494, 69)), // prefer-object-spread useLiteralMessage
    (0x680FDFE8, at(14126, 76)), // func-name-matching notMatchVariable
    (0x686191F3, OF_THE_FIX), // function-component-definition
    (0x686EEEB2, at(25404, 48)), // no-css-tags
    (0x68A1A5BB, at(12346, 147)), // exhaustive-deps
    (0x68B710EF, at(49081, 142)), // no-useless-promise-resolve-reject
    (0x692FE0A5, WITH_DATA | at(41746, 17)), // no-restricted-imports pathWithCustomMessage
    (0x697C0C1E, at(12297, 49)), // exhaustive-deps
    (0x69ABD53A, at(17293, 100)), // jsx-no-literals
    (0x69CCD28C, at(49615, 110)), // no-watch-after-await
    (0x6A29E837, OF_THE_FIX), // prefer-math-trunc
    (0x6A610A9A, at(59602, 25)), // require-param-name
    (0x6B9BE531, OF_THE_FIX), // prefer-prototype-methods
    (0x6B9CF3B0, at(15053, 158)), // hoisted-apis-on-top
    (0x6BCE2B27, more(36)), // require-unicode-regexp requireVFlag
    (0x6BE5A143, at(63744, 38)), // valid-title
    (0x6C4F7631, at(24316, 30)), // no-console unexpected
    (0x6C63014F, at(42132, 34)), // no-script-url unexpectedScriptURL
    (0x6CAC0AD0, more(37)), // no-extra-non-null-assertion noExtraNonNullAssertion
    (0x6D013E47, at(37946, 78)), // no-negated-condition
    (0x6D67D4DA, at(57567, 29)), // prefer-strict-equal
    (0x6D94AF0C, at(40432, 99)), // no-param-reassign assignmentToFunctionParamProp
    (0x6DA49EAF, at(5565, 51)), // ban-types
    (0x6DE8A23F, OF_THE_FIX), // no-empty-named-blocks
    (0x6E4044E9, at(44269, 94)), // no-this-in-sfc
    (0x6E5C6A36, OF_THE_FIX), // function-component-definition
    (0x6E682581, WITH_DATA | at(59227, 83)), // require-mock-type-parameters
    (0x6E72D2C7, at(58266, 82)), // preserve-caught-error missingCause
    (0x6EB15CD7, OF_THE_FIX), // no-null
    (0x6ECB24E9, at(41527, 99)), // no-required-prop-with-default
    (0x6F0AB04C, WITH_DATA | at(41746, 17)), // no-restricted-imports everythingWithAllowedImportNamePatternWithCustomMessage
    (0x6F1DD394, OF_THE_FIX), // object-shorthand expectedMethodShorthand
    (0x6FF55E58, at(48636, 29)), // no-useless-default-assignment uselessUndefined
    (0x70393C91, at(18905, 73)), // missing-throw
    (0x7043F91E, at(34351, 63)), // no-labels unexpectedLabelInContinue
    (0x70558DB2, at(7274, 85)), // consistent-indexed-object-style preferIndexSignature
    (0x70962A56, at(52687, 23)), // prefer-date-now
    (0x709A8728, at(59627, 27)), // require-param-type
    (0x70BF82FC, WITH_DATA | at(33449, 42)), // no-inner-declarations moveDeclToRoot
    (0x710AF355, OF_THE_FIX), // ban-tslint-comment commentDetected
    (0x718431E5, at(9323, 172)), // consistent-type-imports noImportTypeAnnotations
    (0x71BF1211, at(43284, 113)), // no-styled-jsx-in-document
    (0x71C9BA62, more(38)), // no-map-spread
    (0x71DC9E56, at(13814, 31)), // exports-style
    (0x71E0D9DB, at(12297, 49)), // exhaustive-deps
    (0x72888656, at(9938, 62)), // consistent-type-specifier-style
    (0x7289F291, at(23983, 58)), // no-confusing-non-null-assertion confusingAssign
    (0x7316FAB1, at(39725, 83)), // no-noninteractive-element-interactions
    (0x7350C08B, at(63379, 49)), // valid-describe-callback
    (0x7370F353, OF_THE_FIX), // consistent-type-assertions as
    (0x73ADA4DE, OF_THE_FIX), // function-component-definition
    (0x73BD2A09, at(62802, 45)), // use-isnan comparisonWithNaN
    (0x73DAE700, at(50373, 86)), // number-literal-case
    (0x73E689A2, at(14754, 61)), // grouped-accessor-pairs invalidOrder
    (0x73FB5C91, at(39394, 116)), // no-non-null-asserted-nullish-coalescing noNonNullAssertedNullishCoalescing
    (0x74052CCF, at(13477, 31)), // explicit-timer-delay
    (0x7438222A, at(47468, 45)), // no-unused-private-class-members unusedPrivateClassMember
    (0x74772748, WITH_DATA | at(18422, 73)), // max-nested-describe
    (0x7485E6BA, at(61998, 30)), // switch-case-braces
    (0x754980E5, at(59164, 33)), // require-hook
    (0x758E4948, WITH_DATA | at(3633, 183)), // bad-object-literal-comparison
    (0x7616A2A5, WITH_DATA | at(41746, 17)), // no-restricted-imports everythingWithCustomMessage
    (0x764B4A7A, at(58159, 71)), // prefer-ts-expect-error preferExpectErrorComment
    (0x767C35BB, WITH_DATA | at(13902, 50)), // extensions
    (0x76C7C203, at(61546, 54)), // scope
    (0x76FFA74C, at(21205, 26)), // no-async-await
    (0x771243CE, at(58122, 37)), // prefer-top-level-await
    (0x776978BB, at(12525, 44)), // exhaustive-deps
    (0x77997183, at(21873, 143)), // no-await-in-loop unexpectedAwait
    (0x77CDA732, at(46207, 69)), // no-unreadable-iife
    (0x77F7FD45, at(62071, 51)), // tabindex-no-positive
    (0x78474DB3, at(62847, 49)), // use-isnan indexOfNaN
    (0x784C8E87, at(25148, 109)), // no-constructor-return unexpected
    (0x78ED9184, at(26072, 49)), // no-deprecated-events-api
    (0x78F396CE, WITH_DATA | at(54748, 101)), // prefer-function-type unexpectedThisOnFunctionOnlyInterface
    (0x797AD421, more(39)), // no-non-null-asserted-optional-chain noNonNullOptionalChain
    (0x798BFAED, at(6103, 51)), // capitalized-comments unexpectedLowercaseComment
    (0x79D87FD1, at(51837, 105)), // prefer-await-to-then
    (0x7A5C1437, at(56956, 78)), // prefer-regexp-test
    (0x7A83C681, more(40)), // consistent-type-assertions unexpectedArrayTypeAssertion
    (0x7B1FB820, at(58965, 31)), // require-array-join-separator
    (0x7B6BF287, OF_THE_FIX | 2), // consistent-type-definitions interfaceOverType
    (0x7B8E21D0, at(62177, 109)), // triple-slash-reference tripleSlashReference
    (0x7BA56C1B, at(46384, 121)), // no-unsafe-member-access unsafeThisMemberExpression
    (0x7BA57611, at(37282, 89)), // no-multi-str multilineString
    (0x7BE6F2F9, at(24251, 30)), // no-confusing-void-expression invalidVoidExprReturnLast
    (0x7CBAD694, OF_THE_FIX), // no-test-prefixes
    (0x7CC8D36D, at(12708, 220)), // exhaustive-deps
    (0x7D500530, at(64258, 57)), // void-dom-elements-no-children
    (0x7D8088CC, WITH_DATA | at(53189, 58)), // prefer-each
    (0x7D83D2BA, WITH_DATA | at(52622, 45)), // prefer-comparison-matcher
    (0x7D9F2601, at(30723, 97)), // no-floating-promises floating
    (0x7DA5DD05, at(6553, 78)), // class-literal-property-style preferFieldStyle
    (0x7DA8315F, at(33717, 144)), // no-interactive-element-to-noninteractive-role
    (0x7DEA67FA, more(41)), // no-non-null-assertion noNonNull
    (0x7DF33290, OF_THE_FIX), // explicit-length-check
    (0x7E03A6C9, at(30349, 56)), // no-extraneous-class onlyStatic
    (0x7E327F05, WITH_DATA | at(52228, 43)), // prefer-called-with
    (0x7E38A935, at(10202, 88)), // const-comparisons
    (0x7E3DED4F, at(15498, 46)), // iframe-has-title
    (0x7E5C6924, WITH_DATA | at(11067, 47)), // default
    (0x7EF65762, at(62896, 24)), // valid-define-props
    (0x7F15A285, at(32937, 48)), // no-implied-eval impliedEval
    (0x7F38C6CD, OF_THE_FIX), // jsx-boolean-value
    (0x7F86BC56, OF_THE_FIX), // catch-error-name
    (0x7F943CCB, at(40071, 160)), // no-object-type-as-default-prop
    (0x801EF696, WITH_DATA | at(1372, 176)), // array-callback-return expectedNoReturnValue
    (0x80AC457B, at(5616, 109)), // ban-types
    (0x810DC9D9, at(17052, 154)), // jsx-no-new-object-as-prop
    (0x81181E35, at(12219, 78)), // exhaustive-deps
    (0x81ECF042, OF_THE_FIX), // no-unused-labels unused
    (0x81F75B05, at(20323, 83)), // no-array-callback-reference
    (0x822664B6, at(64156, 102)), // vars-on-top top
    (0x823B2F2D, at(12975, 29)), // expect-expect
    (0x823B4E38, at(16778, 209)), // jsx-no-constructed-context-values
    (0x824F9C6D, at(6277, 67)), // check-access
    (0x82801981, WITH_DATA | at(55501, 40)), // prefer-lowercase-title
    (0x82B929F0, at(14592, 79)), // group-exports
    (0x8303A4C7, at(42908, 67)), // no-single-promise-in-promise-methods
    (0x831BBAE5, at(39286, 108)), // no-nodejs-modules
    (0x83439EE7, at(17052, 154)), // jsx-no-new-function-as-prop
    (0x83451D02, WITH_DATA | at(5908, 76)), // button-has-type
    (0x835861AA, at(58645, 63)), // radix missingParameters
    (0x8360E1E4, at(29360, 29)), // no-exports-assign
    (0x838A42D5, OF_THE_FIX), // prefer-string-replace-all
    (0x83E2D9AC, OF_THE_FIX), // prefer-string-replace-all
    (0x841A2F88, at(13065, 141)), // explicit-member-accessibility missingAccessibility
    (0x84551859, at(6473, 44)), // checked-requires-onchange-or-readonly
    (0x8471437D, at(60525, 65)), // require-test-timeout
    (0x8484729E, at(38178, 53)), // no-nested-ternary
    (0x84AB82D0, at(57200, 128)), // prefer-snapshot-hint
    (0x84BCD86A, OF_THE_FIX), // sort-imports sortMembersAlphabetically
    (0x84CC3F4B, at(39989, 44)), // no-obj-calls unexpectedCall
    (0x853D3736, at(14476, 56)), // google-font-display
    (0x856525FC, OF_THE_FIX), // curly missingCurlyAfterCondition
    (0x85AF642F, WITH_DATA | more(42)), // no-const-assign const
    (0x863835C0, at(59797, 42)), // require-property-description
    (0x872D13BE, WITH_DATA | at(47057, 86)), // no-unsafe-negation unexpected
    (0x87322D5F, WITH_DATA | at(24281, 35)), // no-console limited
    (0x8768308E, at(26348, 85)), // no-direct-mutation-state
    (0x8771A3F9, at(63156, 65)), // valid-define-props
    (0x87889300, at(60282, 139)), // require-test-timeout
    (0x87A24908, at(15455, 43)), // html-has-lang
    (0x87C0B7B7, at(27918, 72)), // no-dynamic-require
    (0x87C6AE3E, more(43)), // prefer-dom-node-remove
    (0x87E2FF31, more(44)), // no-anonymous-default-export
    (0x880E8CF7, at(34546, 121)), // no-lone-blocks redundantBlock
    (0x882EDA31, at(24180, 33)), // no-confusing-void-expression invalidVoidExprArrow
    (0x88327F58, WITH_DATA | at(39182, 78)), // no-new-statics
    (0x88746CF5, at(19642, 38)), // no-abusive-eslint-disable
    (0x8874C6B0, at(19151, 79)), // namespace
    (0x88C9C57E, at(9866, 72)), // consistent-type-specifier-style
    (0x89246B3B, at(27990, 75)), // no-else-return unexpected
    (0x8963104E, at(63927, 63)), // valid-title
    (0x898463D4, WITH_DATA | at(40630, 48)), // no-plusplus unexpectedUnaryOp
    (0x899EA758, at(22798, 135)), // no-caller unexpected
    (0x8A213DEC, at(59310, 35)), // require-module-attributes
    (0x8A89DF45, at(45975, 58)), // no-unneeded-ternary unnecessaryConditionalAssignment
    (0x8A9605FE, more(45)), // no-loss-of-precision noLossOfPrecision
    (0x8ABD121A, at(12297, 49)), // exhaustive-deps
    (0x8AD4C18A, at(59197, 30)), // require-local-test-context-for-concurrent-snapshots
    (0x8AE6F07F, at(61936, 27)), // switch-case-braces
    (0x8B6CA6B8, OF_THE_FIX | more(46)), // require-post-message-target-origin
    (0x8B9EEF6D, OF_THE_FIX | 1), // jsx-no-useless-fragment
    (0x8BA1D2F1, at(34441, 105)), // no-lifecycle-after-await
    (0x8BA4818B, at(10124, 78)), // const-comparisons
    (0x8C9A3028, OF_THE_FIX), // consistent-empty-array-spread
    (0x8D1408A7, WITH_DATA | more(47)), // no-shadow noEnumShadow
    (0x8D4EEAAF, at(30274, 75)), // no-extraneous-class onlyConstructor
    (0x8D628DE3, at(28523, 45)), // no-empty-static-block unexpected
    (0x8D7C59AE, at(23507, 58)), // no-cond-assign unexpected
    (0x8D88D57B, WITH_DATA | at(6681, 54)), // class-methods-use-this missingThis
    (0x8DA73E29, WITH_DATA | more(48)), // prefer-expect-type-of
    (0x8EC92FCB, at(44837, 86)), // no-unassigned-vars unassigned
    (0x9021BBE3, at(28417, 106)), // no-empty-object-type noEmptyObject
    (0x90BD2E9A, more(49)), // new-cap lower
    (0x90C03318, WITH_DATA | at(55728, 102)), // prefer-named-capture-group required
    (0x914A5EF2, at(22767, 31)), // no-callback-in-promise
    (0x9199CAC4, at(30506, 89)), // no-fallthrough unusedFallthroughComment
    (0x921522BD, at(63114, 42)), // valid-define-props
    (0x92842C3D, WITH_DATA | at(41746, 17)), // no-restricted-imports everythingWithAllowImportNamesAndCustomMessage
    (0x9285F5BC, at(63595, 62)), // valid-expect
    (0x92899C84, at(41670, 76)), // no-restricted-globals customMessage
    (0x92AF00FF, more(50)), // no-anonymous-default-export
    (0x92DE5142, at(1038, 49)), // anchor-is-valid
    (0x930BC3EC, at(49367, 59)), // no-useless-switch-case
    (0x930CE0BB, at(19680, 181)), // no-access-key
    (0x936D88A9, at(24083, 60)), // no-confusing-set-timeout
    (0x93E80588, WITH_DATA | more(51)), // ban-ts-comment tsDirectiveCommentRequiresDescription
    (0x93FAA91F, at(48927, 20)), // no-useless-iterator-to-array
    (0x93FFFE35, more(52)), // no-map-spread
    (0x94116C9A, WITH_DATA | OF_THE_FIX | more(53)), // no-wrapper-object-types bannedClassType
    (0x9477C5C2, at(6205, 72)), // check-access
    (0x94EDCB08, at(46908, 82)), // no-unsafe-finally unsafeUsage
    (0x95283D32, at(25257, 36)), // no-continue unexpected
    (0x95474AF7, OF_THE_FIX), // prefer-string-starts-ends-with
    (0x9573D46D, at(14532, 60)), // google-font-preconnect
    (0x95E7A825, at(60468, 57)), // require-test-timeout
    (0x95FED5F5, at(48690, 103)), // no-useless-error-capture-stack-trace
    (0x96A87BDE, at(16413, 59)), // jsx-fragments
    (0x97730A48, at(35462, 102)), // no-magic-numbers useConst
    (0x97CD5B21, at(18815, 60)), // method-signature-style errorProperty
    (0x98214428, at(56628, 87)), // prefer-promise-reject-errors rejectAnError
    (0x984ACAFA, OF_THE_FIX), // explicit-length-check
    (0x9860D0C0, at(52965, 50)), // prefer-dom-node-append
    (0x98B1D184, at(52353, 74)), // prefer-class-fields
    (0x98C42E09, at(47166, 75)), // no-unsafe-optional-chaining unsafeOptionalChain
    (0x98F58515, at(14246, 48)), // func-names unnamed
    (0x98F68BCF, OF_THE_FIX), // prefer-math-min-max
    (0x99B68D6E, at(49561, 23)), // no-void noVoid
    (0x99EBCD74, at(51146, 76)), // prefer-array-find
    (0x9A28EDC3, at(34050, 38)), // no-irregular-whitespace noIrregularWhitespace
    (0x9A5B5A31, OF_THE_FIX), // component-definition-name-casing
    (0x9ABD1E60, at(33903, 53)), // no-invalid-remove-event-listener
    (0x9AF51DCD, at(28150, 40)), // no-empty-file
    (0x9B264F04, at(6735, 114)), // click-events-have-key-events
    (0x9B4D6B59, at(33086, 29)), // no-import-node-test
    (0x9B7C4335, at(18354, 68)), // max-nested-calls
    (0x9C1E1379, at(33956, 94)), // no-invalid-void-type invalidVoidUnionConstituent
    (0x9C4495C1, at(17660, 120)), // label-has-associated-control
    (0x9CAFDEED, at(62286, 87)), // unambiguous
    (0x9CE88A4B, at(51222, 36)), // prefer-array-flat
    (0x9CEA1942, WITH_DATA | at(60659, 42)), // require-to-throw-message
    (0x9D0C9DCE, at(22016, 18)), // no-await-in-promise-methods
    (0x9DA05EA0, at(17393, 115)), // jsx-no-literals
    (0x9DC29154, at(18132, 31)), // max-depth tooDeeply
    (0x9E01697E, OF_THE_FIX), // jsx-boolean-value
    (0x9E236B61, at(32268, 25)), // no-identical-title
    (0x9EC2FE79, at(63340, 39)), // valid-describe-callback
    (0x9FE1D3CE, at(48927, 20)), // no-useless-iterator-to-array
    (0xA01AC578, at(52427, 93)), // prefer-class-fields
    (0xA032BEA0, more(54)), // no-duplicate-imports import
    (0xA04674AC, OF_THE_FIX), // prefer-dom-node-dataset
    (0xA087B343, at(32109, 124)), // no-html-link-for-pages
    (0xA09B127D, WITH_DATA | at(4073, 208)), // ban-ts-comment tsDirectiveComment
    (0xA0B67ACB, at(62920, 43)), // valid-define-emits
    (0xA0D015A0, at(31597, 23)), // no-focused-tests
    (0xA0E2E977, OF_THE_FIX | 1), // jsx-curly-brace-presence
    (0xA0E3B9A9, at(64063, 93)), // valid-title
    (0xA11E2B4B, WITH_DATA | at(10376, 86)), // const-comparisons
    (0xA1395355, at(20945, 126)), // no-array-sort
    (0xA13F3933, at(63568, 27)), // valid-expect
    (0xA14925FC, at(15590, 134)), // iframe-missing-sandbox
    (0xA1656366, at(52733, 50)), // prefer-default-parameters
    (0xA1AA64D9, at(61752, 35)), // strict-boolean-expressions conditionErrorNullableObject
    (0xA1EBE911, at(41782, 105)), // no-return-assign arrowAssignment
    (0xA21E96A6, at(63990, 73)), // valid-title
    (0xA237E215, at(61014, 31)), // require-yields
    (0xA239492E, WITH_DATA | more(55)), // no-global-assign globalShouldNotBeModified
    (0xA24F6A04, WITH_DATA | at(41746, 17)), // no-restricted-imports patternAndEverythingWithCustomMessage
    (0xA299A7EB, OF_THE_FIX), // prefer-prototype-methods
    (0xA2BB9DDF, more(56)), // no-anonymous-default-export
    (0xA35BBFF4, at(40033, 38)), // no-object-constructor preferLiteral
    (0xA36125B5, at(18740, 75)), // method-signature-style errorMethod
    (0xA37216DA, at(37196, 47)), // no-multi-assign unexpectedChain
    (0xA39911F7, at(2551, 128)), // await-thenable invalidPromiseAggregatorInput
    (0xA3CD3DCF, at(62373, 124)), // unbound-method unboundWithoutThisAnnotation
    (0xA3FE0095, at(14671, 83)), // group-exports
    (0xA45423F7, at(63279, 22)), // valid-describe-callback
    (0xA482BD6C, at(18086, 46)), // max-dependencies
    (0xA4A4D8EB, more(57)), // no-duplicate-imports exportAs
    (0xA4C84134, at(51258, 66)), // prefer-array-flat-map
    (0xA4E55B7F, at(58996, 38)), // require-await missingAwait
    (0xA4EBAE34, at(39142, 40)), // no-new-require
    (0xA4FEC9F7, at(38120, 58)), // no-nested-ternary
    (0xA550E5CF, WITH_DATA | at(56317, 41)), // prefer-number-coercion
    (0xA5713C0F, at(51514, 30)), // prefer-arrow-callback preferArrowCallback
    (0xA59D59AF, at(46061, 73)), // no-unreachable unreachableCode
    (0xA5DF2034, at(37729, 29)), // no-named-default
    (0xA63FC691, WITH_DATA | at(19019, 55)), // named
    (0xA65E38C7, at(63015, 46)), // valid-define-props
    (0xA680EB4A, OF_THE_FIX), // prefer-importing-jest-globals
    (0xA6848C64, WITH_DATA | at(47342, 81)), // no-untyped-mock-factory
    (0xA6A3075C, at(13508, 39)), // explicit-timer-delay
    (0xA6C73740, at(14922, 62)), // handle-callback-err
    (0xA6DEB743, at(60249, 33)), // require-returns-type
    (0xA6DF883A, more(58)), // no-confusing-array-with
    (0xA740D924, at(16599, 52)), // jsx-key
    (0xA7D7E9CA, at(24790, 35)), // no-constant-binary-expression alwaysNew
    (0xA7EE021C, WITH_DATA | at(10070, 54)), // consistent-vitest-vi
    (0xA81B952C, at(37371, 44)), // no-multiple-slot-args
    (0xA83C3DF8, WITH_DATA | at(18163, 65)), // max-expects
    (0xA86EE8DB, at(48465, 41)), // no-useless-constructor noUselessConstructor
    (0xA872474E, at(63061, 53)), // valid-define-emits
    (0xA88D6F0B, WITH_DATA | at(7115, 72)), // consistent-function-scoping
    (0xA8D87DAF, at(37758, 93)), // no-named-export
    (0xA94E0D11, OF_THE_FIX), // prefer-string-raw
    (0xA95AEAAE, at(43882, 81)), // no-this-alias thisDestructure
    (0xA97AE8D9, WITH_DATA | at(54748, 101)), // prefer-function-type functionTypeOverCallableType
    (0xA9FE8F0B, WITH_DATA | at(53917, 105)), // prefer-expect-assertions
    (0xAA0E7FA2, at(10924, 143)), // control-has-associated-label
    (0xAA1D712D, WITH_DATA | at(40930, 74)), // no-prototype-builtins prototypeBuildIn
    (0xAA3BF80C, WITH_DATA | at(13845, 57)), // extensions
    (0xAABFCF80, at(40708, 23)), // no-process-exit
    (0xAAC75309, more(59)), // no-clone-element
    (0xAAC8A001, at(13004, 61)), // explicit-function-return-type missingReturnType
    (0xAB22E794, at(37851, 28)), // no-namespace
    (0xAB539868, WITH_DATA | at(57657, 100)), // prefer-tag-over-role
    (0xAB8EDC17, at(61600, 31)), // self-closing-comp
    (0xAB94B666, at(10841, 39)), // constructor-super missingAll
    (0xABA004B6, at(55039, 35)), // prefer-hooks-on-top
    (0xAC654D44, at(45781, 33)), // no-unnecessary-parameter-property-assignment unnecessaryAssign
    (0xAC9E9DCA, at(59879, 37)), // require-property-type
    (0xACC35EBF, OF_THE_FIX), // no-test-prefixes
    (0xAD4FC5F0, at(41626, 25)), // no-restricted-exports restrictedDefault
    (0xADA5BAA4, at(23436, 71)), // no-compare-neg-zero unexpected
    (0xADB36002, OF_THE_FIX), // object-shorthand expectedLiteralMethodLongform
    (0xADEA61F1, at(33, 33)), // accessor-pairs missingSetterInClass
    (0xAE5D281B, more(60)), // no-dupe-keys unexpected
    (0xAE60BBEC, at(6922, 62)), // consistent-date-clone
    (0xAE6C3BCE, at(15724, 50)), // iframe-missing-sandbox
    (0xAECB2492, at(50289, 47)), // number-literal-case
    (0xAEDB1D74, at(33388, 26)), // no-inferrable-types noInferrableType
    (0xAF7C8CF2, at(33, 33)), // accessor-pairs missingSetterInObjectLiteral
    (0xAF9C23C1, at(46033, 28)), // no-unneeded-ternary unnecessaryConditionalExpression
    (0xAFEE01B5, at(41626, 25)), // no-restricted-exports restrictedDefault
    (0xAFEFB54A, WITH_DATA | at(41746, 17)), // no-restricted-imports patternWithCustomMessage
    (0xB01C9482, at(44763, 74)), // no-unassigned-import
    (0xB053E134, at(46384, 121)), // no-unsafe-return unsafeReturnThis
    (0xB0BF39D1, at(52783, 122)), // prefer-describe-function-title
    (0xB0C09E23, at(43071, 77)), // no-static-element-interactions
    (0xB0CC8CAD, WITH_DATA | at(50145, 41)), // no-zero-fractions
    (0xB0D16A25, at(32015, 94)), // no-hooks
    (0xB107B85E, at(39886, 43)), // no-noninteractive-tabindex
    (0xB12E5352, at(6154, 51)), // capitalized-comments unexpectedUppercaseComment
    (0xB19ED905, WITH_DATA | at(20024, 66)), // no-alias-methods
    (0xB1A814F2, OF_THE_FIX | 2), // array-type errorStringGenericSimple
    (0xB2443EEA, at(39260, 26)), // no-new-wrappers notAConstructor
    (0xB296BFEB, at(60165, 42)), // require-returns
    (0xB2C78415, at(31064, 157)), // no-floating-promises floatingUselessRejectionHandler
    (0xB2D20D3D, at(12493, 32)), // exhaustive-deps
    (0xB34DAB4C, at(973, 65)), // anchor-has-content
    (0xB42720B5, at(3138, 207)), // bad-comparison-sequence
    (0xB4484750, at(41670, 76)), // no-restricted-globals defaultMessage
    (0xB4873FEE, at(47143, 23)), // no-unsafe-optional-chaining unsafeArithmetic
    (0xB5917204, at(31900, 52)), // no-head-element
    (0xB5B04ECD, at(12171, 48)), // exhaustive-deps
    (0xB5D340E7, at(27647, 50)), // no-duplicates
    (0xB63C4486, at(21143, 62)), // no-assign-module-variable
    (0xB6495F3F, OF_THE_FIX), // prefer-numeric-literals useLiteral
    (0xB6FEBA1F, at(20576, 62)), // no-array-index-key
    (0xB733DAF4, at(50594, 88)), // only-used-in-recursion
    (0xB7864DFF, at(33043, 43)), // no-import-compiler-macros
    (0xB7A2A3A3, at(40288, 58)), // no-page-custom-font
    (0xB7B1DBBD, WITH_DATA | at(54293, 55)), // prefer-expect-assertions
    (0xB7E68201, at(21741, 33)), // no-autofocus
    (0xB888DD19, at(15544, 46)), // iframe-missing-sandbox
    (0xB8C4F070, more(61)), // no-img-element
    (0xB908C6F3, WITH_DATA | at(45053, 77)), // no-underscore-dangle unexpectedUnderscore
    (0xB94A4974, at(33623, 94)), // no-instanceof-builtins
    (0xB9649756, at(37946, 78)), // no-negated-condition unexpectedNegated
    (0xB9C0660B, at(58266, 82)), // preserve-caught-error incorrectCause
    (0xB9DF2664, at(46134, 73)), // no-unreachable-loop invalid
    (0xBA35DD43, at(57171, 29)), // prefer-single-call
    (0xBAAFC30B, at(54348, 40)), // prefer-expect-resolves
    (0xBACA7360, at(19074, 77)), // namespace
    (0xBAEB47B1, at(55184, 51)), // prefer-import-meta-properties
    (0xBAFB064B, at(24951, 70)), // no-constant-binary-expression constantShortCircuit
    (0xBB8E23B2, OF_THE_FIX), // no-typeof-undefined
    (0xBB941C45, more(62)), // ban-types
    (0xBBB60C82, at(57811, 49)), // prefer-ternary
    (0xBBDC9945, at(18006, 39)), // lang
    (0xBC20EDA4, at(63858, 37)), // valid-title
    (0xBC23A703, at(44363, 87)), // no-throw-literal object
    (0xBC32FC4D, at(15211, 46)), // hook-use-state
    (0xBC421B75, at(44450, 62)), // no-title-in-document-head
    (0xBC5457DD, at(59839, 40)), // require-property-name
    (0xBCD177C5, at(60631, 28)), // require-throws-type
    (0xBD73E97F, at(61705, 47)), // strict-boolean-expressions conditionErrorAny
    (0xBD8E1A3D, at(20406, 38)), // no-array-constructor useLiteral
    (0xBDAA4491, at(56398, 96)), // prefer-object-from-entries
    (0xBDFFAF10, at(63221, 58)), // valid-describe-callback
    (0xBE055C31, at(49584, 31)), // no-warning-comments unexpectedComment
    (0xBE056113, OF_THE_FIX), // prefer-import-from-vue
    (0xBE2456FB, OF_THE_FIX), // operator-assignment replaced
    (0xBE70D594, at(24041, 42)), // no-confusing-non-null-assertion confusingEqual
    (0xBEAC061A, at(37118, 78)), // no-mocks-import
    (0xBEC89835, at(56563, 65)), // prefer-object-spread useSpreadMessage
    (0xBED5EED0, at(55287, 22)), // prefer-jest-mocked
    (0xBED66FB7, at(36839, 56)), // no-misused-spread noPromiseSpreadInObject
    (0xBF2CCD40, WITH_DATA | at(25787, 50)), // no-defaults
    (0xBFCE433D, OF_THE_FIX), // prefer-array-some
    (0xBFDF8F0D, WITH_DATA | at(4281, 89)), // ban-ts-comment tsDirectiveCommentDescriptionNotMatchPattern
    (0xBFDF9F72, at(10880, 44)), // constructor-super missingSome
    (0xC032897D, at(2145, 83)), // avoid-new
    (0xC0F0D78A, at(43449, 46)), // no-template-curly-in-string unexpectedTemplateExpression
    (0xC12E8574, at(7441, 46)), // consistent-template-literal-escape
    (0xC145FD68, OF_THE_FIX), // curly unexpectedCurlyAfterCondition
    (0xC1BBA066, WITH_DATA | at(1132, 35)), // approx-constant
    (0xC1CA8D7D, at(18577, 81)), // max-props
    (0xC1E275BC, at(44363, 87)), // no-throw-literal undef
    (0xC2008EC6, at(59510, 27)), // require-param
    (0xC20FCE34, at(16651, 127)), // jsx-key
    (0xC2AE9121, more(63)), // no-useless-constructor noUselessConstructor
    (0xC2D7E692, at(61436, 110)), // rules-of-hooks
    (0xC316E67B, more(64)), // no-unexpected-multiline property
    (0xC370CDF0, at(27227, 143)), // no-duplicate-head
    (0xC3C08E65, more(65)), // no-unexpected-multiline taggedTemplate
    (0xC3F8879F, at(44080, 74)), // no-this-in-before-route-enter
    (0xC434E826, OF_THE_FIX), // prefer-to-be-truthy
    (0xC482FC9B, at(1087, 45)), // anchor-is-valid
    (0xC488C6EB, at(20812, 133)), // no-array-reverse
    (0xC4AF6C32, at(53673, 49)), // prefer-equality-matcher
    (0xC4DE872E, OF_THE_FIX), // curly missingCurlyAfter
    (0xC52F8ED0, WITH_DATA | at(44726, 37)), // no-typos
    (0xC5475EA0, at(4827, 45)), // ban-ts-comment tsIgnoreInsteadOfExpectError
    (0xC572B7B0, more(66)), // no-dupe-else-if unexpected
    (0xC5D7A5F7, OF_THE_FIX), // object-shorthand expectedPropertyShorthand
    (0xC5DC7B37, at(41887, 67)), // no-return-in-finally
    (0xC5ECFCBE, at(40866, 64)), // no-proto unexpectedProto
    (0xC5F3BE7B, at(55424, 46)), // prefer-literal-enum-member notLiteralOrBitwiseExpression
    (0xC6329069, WITH_DATA | at(41774, 8)), // no-restricted-properties restrictedObjectProperty
    (0xC63E95BF, at(33956, 94)), // no-invalid-void-type invalidVoidNotReturnOrThisParamOrGeneric
    (0xC647D82B, WITH_DATA | at(41261, 68)), // no-redundant-roles
    (0xC685CA97, at(62802, 45)), // use-isnan comparisonWithNaN
    (0xC73061CC, WITH_DATA | at(54067, 106)), // prefer-expect-assertions
    (0xC8028D27, at(12069, 102)), // exhaustive-deps
    (0xC86D58A2, more(67)), // no-use-before-define noUseBeforeDefine
    (0xC8913BD3, at(11260, 44)), // display-name
    (0xC8BAEEFF, at(51544, 53)), // prefer-as-const variableConstAssertion
    (0xC8F042E1, at(55470, 31)), // prefer-logical-operator-over-ternary
    (0xC91DE135, at(61838, 45)), // strict-boolean-expressions conditionErrorNullableNumber
    (0xC9719D8B, at(17206, 87)), // jsx-no-literals
    (0xC996806F, at(43213, 32)), // no-string-refs
    (0xC9D5923E, at(52271, 82)), // prefer-catch
    (0xCA374218, at(6517, 36)), // checked-requires-onchange-or-readonly
    (0xCA492FE3, at(57397, 57)), // prefer-spread
    (0xCA4A3180, at(60129, 36)), // require-returns
    (0xCA94982D, WITH_DATA | at(41746, 17)), // no-restricted-imports patternAndEverythingWithRegexImportNameAndCustomMessage
    (0xCB04B359, at(61045, 39)), // require-yields
    (0xCB07DF7B, at(16021, 59)), // init-declarations initialized
    (0xCB71F493, at(42442, 65)), // no-setter-return returnsValue
    (0xCB8E4930, at(23983, 58)), // no-confusing-non-null-assertion confusingOperator
    (0xCBA8F125, WITH_DATA | more(68)), // prefer-keyboard-event-key
    (0xCBA9E28F, OF_THE_FIX), // object-shorthand expectedMethodLongform
    (0xCBB7DD3F, at(28112, 38)), // no-empty-character-class unexpected
    (0xCBC1058B, at(59721, 76)), // require-property
    (0xCC066ACD, at(41626, 25)), // no-restricted-exports restrictedDefault
    (0xCC4B2F1B, WITH_DATA | at(46276, 108)), // no-unsafe
    (0xCC71F6DB, at(48793, 134)), // no-useless-fallback-in-spread
    (0xCCDD9B36, more(69)), // no-ex-assign unexpected
    (0xCD6621D3, at(34351, 63)), // no-labels unexpectedLabelInBreak
    (0xCD7F4FBF, at(2348, 102)), // await-thenable awaitUsingOfNonAsyncDisposable
    (0xCDE5A417, at(29265, 95)), // no-export
    (0xCDF86BF9, at(48077, 41)), // no-useless-call unnecessaryCall
    (0xCEE2352D, WITH_DATA | at(20090, 42)), // no-amd
    (0xCF7B7BEF, at(43633, 112)), // no-thenable
    (0xCF8B528E, at(52520, 32)), // prefer-classlist-toggle
    (0xCFE5E9CF, at(34414, 27)), // no-length-as-slice-end
    (0xD000C747, OF_THE_FIX), // prefer-to-be-falsy
    (0xD0426592, WITH_DATA | at(2874, 101)), // bad-bitwise-operator
    (0xD047BF05, at(48927, 20)), // no-useless-iterator-to-array
    (0xD072A46A, at(22264, 196)), // no-base-to-string baseArrayJoin
    (0xD105B19C, WITH_DATA | at(24902, 49)), // no-constant-binary-expression constantRelationalComparison
    (0xD184DFD1, at(61963, 35)), // switch-case-braces
    (0xD1AE8B99, at(57922, 114)), // prefer-to-have-been-called
    (0xD1CF7539, at(18998, 21)), // mouse-events-have-key-events
    (0xD1D097D1, at(356, 137)), // alt-text
    (0xD1E9140B, at(45752, 29)), // no-unnecessary-await
    (0xD20E792C, WITH_DATA | at(55074, 110)), // prefer-import-in-mock
    (0xD359EFA2, at(7359, 82)), // consistent-indexed-object-style preferRecord
    (0xD39CB001, at(12021, 48)), // exhaustive-deps
    (0xD3AA1A97, OF_THE_FIX), // prefer-object-has-own useHasOwn
    (0xD3CC24A7, at(36481, 142)), // no-misleading-character-class zwj
    (0xD3E94999, at(40231, 57)), // no-page-custom-font
    (0xD3FDEBA0, at(17052, 154)), // jsx-no-jsx-as-prop
    (0xD40EEE3E, at(63782, 76)), // valid-title
    (0xD439F657, more(70)), // no-anonymous-default-export
    (0xD49AB8F2, at(13695, 68)), // exports-last
    (0xD49EBEE9, more(71)), // constructor-super badSuper
    (0xD4AAB97B, at(50336, 37)), // number-literal-case
    (0xD513A642, at(24346, 165)), // no-console-spaces
    (0xD5BEDB50, at(57860, 62)), // prefer-to-be-object
    (0xD6C0B474, at(43495, 34)), // no-ternary noTernaryOperator
    (0xD6C97C3E, OF_THE_FIX | 1), // jsx-no-useless-fragment
    (0xD70F0A96, at(45670, 19)), // no-unnecessary-array-flat-depth
    (0xD881F071, at(61259, 60)), // return-in-computed-property
    (0xD885CC19, at(17052, 154)), // jsx-no-new-array-as-prop
    (0xD899622F, at(41626, 25)), // no-restricted-exports restrictedDefault
    (0xD8B5E5F7, at(55622, 66)), // prefer-module
    (0xD8F65EC5, WITH_DATA | at(6849, 73)), // consistent-assert
    (0xD8FE53AF, at(61631, 74)), // sort-vars sortVars
    (0xD90EF359, WITH_DATA | at(28065, 47)), // no-empty unexpected
    (0xD90F5410, at(56715, 160)), // prefer-query-selector
    (0xD9416D6B, at(34711, 48)), // no-lonely-if
    (0xD950E53F, WITH_DATA | at(24825, 77)), // no-constant-binary-expression constantBinaryOperand
    (0xD9B7948F, at(56219, 45)), // prefer-negative-index
    (0xDA31B749, at(52687, 23)), // prefer-date-now
    (0xDA5D85E6, at(57504, 63)), // prefer-strict-boolean-matchers
    (0xDAD8A3E8, at(37879, 67)), // no-namespace moduleSyntaxIsPreferred
    (0xDB10F975, more(72)), // new-cap upper
    (0xDB48F444, at(2975, 163)), // bad-char-at-comparison
    (0xDB54409C, at(15774, 210)), // img-redundant-alt
    (0xDB81EC87, at(22460, 158)), // no-base-to-string baseToString
    (0xDBB6158F, at(14391, 45)), // getter-return expected
    (0xDC61091E, at(15354, 101)), // html-has-lang
    (0xDC68306F, at(25452, 145)), // no-danger
    (0xDC7EB91E, WITH_DATA | more(73)), // no-label-var identifierClashWithLabel
    (0xDCC5E572, at(48636, 29)), // no-useless-default-assignment uselessDefaultAssignment
    (0xDCEEC554, at(63458, 25)), // valid-expect
    (0xDDEE2678, OF_THE_FIX), // require-prop-type-constructor
    (0xDDF7FF7A, at(23507, 58)), // no-cond-assign missing
    (0xDE3B446F, at(34759, 33)), // no-lonely-if unexpectedLonelyIf
    (0xDE487B04, at(29740, 69)), // no-extra-boolean-cast unexpectedNegation
    (0xDE9B852F, WITH_DATA | at(37471, 63)), // no-mutable-exports
    (0xDF3909E4, at(10000, 70)), // consistent-type-specifier-style
    (0xDF3EE5E7, at(30905, 159)), // no-floating-promises floatingPromiseArrayVoid
    (0xDF9AB5F1, WITH_DATA | more(74)), // ban-types
    (0xDFFFA08C, at(31221, 218)), // no-floating-promises floatingUselessRejectionHandlerVoid
    (0xE03E56A7, at(41492, 35)), // no-require-imports noRequireImports
    (0xE044E499, at(42297, 54)), // no-self-import
    (0xE04FD184, at(41651, 19)), // no-restricted-exports restrictedNamed
    (0xE09BFF21, more(75)), // jsx-curly-brace-presence
    (0xE09D0B18, WITH_DATA | at(28568, 49)), // no-eq-null unexpected
    (0xE0D8226F, more(76)), // no-document-cookie
    (0xE0E05D83, at(62896, 24)), // valid-define-emits
    (0xE0EBE6D3, at(47289, 53)), // no-unsafe-type-assertion unsafeToAnyTypeAssertion
    (0xE14757CE, more(77)), // no-top-level-await
    (0xE19777DE, WITH_DATA | at(28190, 57)), // no-empty-function unexpected
    (0xE199E5B5, at(52687, 23)), // prefer-date-now
    (0xE1DEC7FC, at(61883, 53)), // strict-boolean-expressions conditionErrorNullableString
    (0xE206BD3B, at(55235, 52)), // prefer-import-meta-properties
    (0xE2277A53, at(19577, 65)), // no-absolute-path
    (0xE306EC1A, at(36895, 223)), // no-misused-spread noStringSpread
    (0xE47FB7DA, at(34792, 167)), // no-loop-func unsafeRefs
    (0xE498E2B0, at(22700, 67)), // no-bitwise unexpected
    (0xE4D0D7C0, OF_THE_FIX), // no-hex-escape
    (0xE4EC54A3, more(78)), // no-constant-condition unexpected
    (0xE4FCAE99, at(27370, 110)), // no-duplicate-hooks
    (0xE50EA630, at(47513, 59)), // no-unwanted-polyfillio
    (0xE565B460, WITH_DATA | at(11512, 41)), // empty-tags
    (0xE5685438, WITH_DATA | at(29809, 120)), // no-extra-label unexpected
    (0xE568A058, at(13547, 73)), // export
    (0xE580006E, at(57328, 69)), // prefer-snapshot-hint
    (0xE5EBCD1C, at(61752, 35)), // strict-boolean-expressions conditionErrorNullableBoolean
    (0xE706377D, at(48433, 32)), // no-useless-concat unexpectedConcat
    (0xE777912D, at(40531, 99)), // no-path-concat
    (0xE7B34C56, OF_THE_FIX), // next-tick-style
    (0xE8B30721, at(59537, 32)), // require-param-description
    (0xE8EE39F8, WITH_DATA | at(41746, 17)), // no-restricted-imports importNameWithCustomMessage
    (0xE92A065A, OF_THE_FIX), // prefer-todo
    (0xE971B765, at(51467, 47)), // prefer-array-some
    (0xE97E09AF, WITH_DATA | at(26475, 114)), // no-distracting-elements
    (0xE99D5267, at(46658, 130)), // no-unsafe-enum-comparison mismatchedCase
    (0xE9B56B33, at(36380, 76)), // no-misleading-character-class surrogatePair
    (0xE9C50A93, at(44154, 115)), // no-this-in-exported-function
    (0xE9E29A8C, WITH_DATA | at(54976, 63)), // prefer-hooks-in-order
    (0xEA3192AA, at(14038, 43)), // for-direction incorrectDirection
    (0xEAB591FB, WITH_DATA | at(55541, 27)), // prefer-mock-promise-shorthand
    (0xEB77512C, WITH_DATA | at(1252, 120)), // array-callback-return expectedInside
    (0xEBC3515F, at(9135, 18)), // consistent-type-exports typeOverValue
    (0xEBF16DC2, at(58708, 112)), // radix missingRadix
    (0xEC2D5854, at(39808, 78)), // no-noninteractive-element-to-interactive-role
    (0xEC613EF3, at(25597, 113)), // no-danger-with-children
    (0xEC763356, at(23565, 36)), // no-conditional-expect
    (0xED78762F, at(63483, 59)), // valid-expect
    (0xEDA48D4E, at(61787, 51)), // strict-boolean-expressions conditionErrorNullableEnum
    (0xEDC9825F, at(43148, 65)), // no-static-only-class
    (0xEE1F5A6E, more(79)), // consistent-type-imports typeOverValue
    (0xEE58986E, at(20444, 132)), // no-array-fill-with-reference-type
    (0xEE6047E3, at(32581, 71)), // no-immediate-mutation
    (0xEF52F1E4, at(26731, 66)), // no-document-import-in-page
    (0xEF897DAB, at(13952, 44)), // first
    (0xEFC0F404, WITH_DATA | at(41746, 17)), // no-restricted-imports allowedImportNamePatternWithCustomMessage
    (0xEFE0EF94, WITH_DATA | at(9082, 53)), // consistent-type-exports singleExportIsType
    (0xEFEBFAA9, at(30257, 17)), // no-extraneous-class empty
    (0xF066073E, at(9153, 170)), // consistent-type-imports avoidImportType
    (0xF156010E, more(80)), // no-confusing-array-with
    (0xF1746AFD, at(32233, 35)), // no-identical-title
    (0xF1896FC1, WITH_DATA | at(61153, 49)), // restrict-plus-operands invalid
    (0xF192F5C4, at(49778, 99)), // no-will-update-set-state
    (0xF1A58E09, at(33414, 35)), // no-inline-comments unexpectedInlineComment
    (0xF1EB9AE8, at(26433, 21)), // no-disabled-tests
    (0xF2BC9BE9, at(5984, 47)), // button-has-type
    (0xF3BF69FE, more(81)), // no-duplicate-imports importAs
    (0xF43B393B, more(82)), // prefer-global-this
    (0xF486CAA1, at(17634, 26)), // jsx-props-no-spread-multi
    (0xF4B54969, WITH_DATA | more(83)), // no-duplicate-enum-values duplicateValue
    (0xF4D295B7, at(58931, 15)), // relative-url-style
    (0xF4DDFB84, at(24790, 35)), // no-constant-binary-expression bothAlwaysNew
    (0xF53870F8, at(58348, 70)), // preserve-caught-error missingCatchErrorParam
    (0xF5A9748D, at(28327, 90)), // no-empty-interface noEmptyWithSuper
    (0xF61463C0, more(84)), // unified-signatures omittingSingleParameter
    (0xF6C8740D, WITH_DATA | at(1167, 47)), // aria-activedescendant-has-tabindex
    (0xF6C8D03B, at(42975, 38)), // no-sparse-arrays unexpectedSparseArray
    (0xF82A7365, at(48927, 20)), // no-useless-iterator-to-array
    (0xF834DBE7, at(47241, 48)), // no-unsafe-type-assertion unsafeOfAnyTypeAssertion
    (0xF84112AB, at(23029, 66)), // no-children-prop
    (0xF894B5A4, at(11933, 88)), // exhaustive-deps
    (0xF95AFE11, at(42068, 64)), // no-script-component-in-head
    (0xF99C9D8A, at(63542, 26)), // valid-expect
    (0xF9B34A33, WITH_DATA | at(41746, 17)), // no-restricted-imports allowedImportNameWithCustomMessage
    (0xFA73A165, at(39260, 26)), // no-new-wrappers noConstructor
    (0xFACAC847, OF_THE_FIX), // prefer-modern-dom-apis
    (0xFB27139E, at(55688, 40)), // prefer-module
    (0xFB660D51, at(63895, 32)), // valid-title
    (0xFC42BC7F, at(32493, 45)), // no-immediate-mutation
    (0xFC4F3444, OF_THE_FIX | 2), // array-type errorStringArraySimple
    (0xFC854321, at(60890, 124)), // require-yield missingYield
    (0xFCA1907E, at(58946, 19)), // relative-url-style
    (0xFCD64168, at(16080, 53)), // inline-script-id
    (0xFD4B6DE8, WITH_DATA | at(52552, 70)), // prefer-code-point
    (0xFD7379FB, at(52667, 20)), // prefer-const useConst
    (0xFE0C8B6D, at(16472, 127)), // jsx-key
    (0xFE1699D3, at(41192, 69)), // no-redeclare redeclaredAsBuiltin
    (0xFE9DD28C, at(18978, 20)), // mouse-events-have-key-events
    (0xFEB93DCB, WITH_DATA | at(50459, 57)), // number-literal-case
    (0xFEE4E16D, at(28417, 106)), // no-empty-object-type noEmptyInterface
    (0xFEFF2620, more(85)), // consistent-type-assertions never
    (0xFF0B6D19, WITH_DATA | at(57596, 28)), // prefer-string-trim-start-end
    (0xFF135B82, at(59976, 153)), // require-render-return
    (0xFF321DDB, at(47889, 48)), // no-useless-assignment unnecessaryAssignment
    (0xFF3DA765, at(62674, 81)), // uninvoked-array-callback
    (0xFF4FF175, at(52710, 23)), // prefer-default-export
    (0xFF674826, OF_THE_FIX), // jsx-boolean-value
    (0xFF73BE67, WITH_DATA | at(3471, 162)), // bad-object-literal-comparison
    (0xFFE6404B, OF_THE_FIX), // operator-assignment unexpected
];

#[rustfmt::skip]
static ROWS: &[Row] = &[
    Row { help: at(51597, 29), first_label: 0, note: at(51626, 89) }, // prefer-at
    Row { help: at(31695, 62), first_label: WITH_DATA | at(31757, 28), note: 0 }, // no-func-assign isAFunction
    Row { help: at(27697, 61), first_label: 0, note: at(27758, 160) }, // no-dynamic-delete dynamicDelete
    Row { help: 0, first_label: at(11135, 41), note: 0 }, // default-case-last notLast
    Row { help: 0, first_label: 0, note: at(20132, 97) }, // no-anonymous-default-export
    Row { help: WITH_DATA | at(53321, 183), first_label: 0, note: at(53504, 169) }, // prefer-enum-initializers defineInitializer
    Row { help: at(23095, 76), first_label: WITH_DATA | at(23171, 34), note: 0 }, // no-class-assign class
    Row { help: at(54593, 52), first_label: 0, note: at(54645, 103) }, // prefer-function-component
    Row { help: at(10749, 35), first_label: at(10784, 57), note: 0 }, // constructor-super duplicate
    Row { help: 0, first_label: 0, note: at(20132, 97) }, // no-anonymous-default-export
    Row { help: at(55830, 60), first_label: 0, note: at(55890, 329) }, // prefer-namespace-keyword useNamespace
    Row { help: at(53722, 135), first_label: 0, note: at(53857, 60) }, // prefer-event-target
    Row { help: 0, first_label: at(62645, 29), note: 0 }, // unified-signatures singleParameterDifference
    Row { help: at(21294, 279), first_label: 0, note: at(21573, 106) }, // no-async-endpoint-handlers
    Row { help: WITH_DATA | at(22034, 161), first_label: 0, note: at(22195, 69) }, // no-barrel-file
    Row { help: at(26797, 102), first_label: WITH_DATA | at(26899, 38), note: 0 }, // no-dupe-class-members unexpected
    Row { help: at(27480, 59), first_label: at(27539, 25), note: 0 }, // no-duplicate-imports export
    Row { help: 0, first_label: at(62573, 29), note: 0 }, // unified-signatures allParametersAreSame
    Row { help: at(8615, 249), first_label: 0, note: at(8864, 218) }, // consistent-type-assertions unexpectedObjectTypeAssertion
    Row { help: at(41004, 67), first_label: 0, note: at(41071, 55) }, // no-react-children
    Row { help: 0, first_label: 0, note: at(19933, 68) }, // no-accumulating-spread loopSpread
    Row { help: 0, first_label: at(62602, 43), note: 0 }, // unified-signatures omittingRestParameter
    Row { help: at(27105, 26), first_label: at(27131, 15), note: 0 }, // no-duplicate-case unexpected
    Row { help: 0, first_label: 0, note: at(19933, 68) }, // no-accumulating-spread reduceSpread
    Row { help: at(45130, 60), first_label: at(45190, 54), note: 0 }, // no-unexpected-multiline division
    Row { help: at(3345, 50), first_label: 0, note: at(3395, 76) }, // bad-match-all-arg
    Row { help: 0, first_label: 0, note: at(20132, 97) }, // no-anonymous-default-export
    Row { help: at(60756, 17), first_label: 0, note: at(60773, 100) }, // require-unicode-regexp requireUFlag
    Row { help: at(21294, 279), first_label: 0, note: at(21573, 106) }, // no-async-endpoint-handlers
    Row { help: at(43529, 64), first_label: 0, note: at(43593, 40) }, // no-test-return-statement
    Row { help: 0, first_label: 0, note: at(20132, 97) }, // no-anonymous-default-export
    Row { help: at(3816, 119), first_label: 0, note: at(3935, 138) }, // bad-replace-all-arg
    Row { help: WITH_DATA | at(42507, 82), first_label: WITH_DATA | at(42589, 27), note: 0 }, // no-shadow noShadow
    Row { help: at(38749, 123), first_label: at(38872, 43), note: at(38915, 168) }, // no-new-func noFunctionConstructor
    Row { help: WITH_DATA | at(66, 102), first_label: 0, note: at(168, 188) }, // adjacent-overload-signatures adjacentSignature
    Row { help: at(45244, 80), first_label: at(45324, 61), note: 0 }, // no-unexpected-multiline function
    Row { help: at(60873, 17), first_label: 0, note: at(60773, 100) }, // require-unicode-regexp requireVFlag
    Row { help: at(29929, 55), first_label: 0, note: at(29984, 273) }, // no-extra-non-null-assertion noExtraNonNullAssertion
    Row { help: at(35564, 102), first_label: 0, note: at(35666, 96) }, // no-map-spread
    Row { help: at(39510, 30), first_label: at(39540, 44), note: 0 }, // no-non-null-asserted-optional-chain noNonNullOptionalChain
    Row { help: at(8147, 253), first_label: 0, note: at(8400, 215) }, // consistent-type-assertions unexpectedArrayTypeAssertion
    Row { help: 0, first_label: 0, note: at(39584, 141) }, // no-non-null-assertion noNonNull
    Row { help: at(24511, 67), first_label: WITH_DATA | at(24578, 37), note: 0 }, // no-const-assign const
    Row { help: at(53015, 70), first_label: 0, note: at(53085, 63) }, // prefer-dom-node-remove
    Row { help: 0, first_label: 0, note: at(20132, 97) }, // no-anonymous-default-export
    Row { help: at(34959, 156), first_label: 0, note: at(35115, 217) }, // no-loss-of-precision noLossOfPrecision
    Row { help: OF_THE_FIX, first_label: 0, note: at(59654, 67) }, // require-post-message-target-origin
    Row { help: WITH_DATA | at(42507, 82), first_label: WITH_DATA | at(42589, 27), note: WITH_DATA | at(42616, 167) }, // no-shadow noEnumShadow
    Row { help: WITH_DATA | at(54388, 41), first_label: 0, note: at(54429, 40) }, // prefer-expect-type-of
    Row { help: at(19230, 118), first_label: at(19348, 24), note: 0 }, // new-cap lower
    Row { help: 0, first_label: 0, note: at(20132, 97) }, // no-anonymous-default-export
    Row { help: WITH_DATA | at(4370, 243), first_label: 0, note: at(4613, 214) }, // ban-ts-comment tsDirectiveCommentRequiresDescription
    Row { help: at(35762, 106), first_label: 0, note: at(35868, 100) }, // no-map-spread
    Row { help: OF_THE_FIX, first_label: 0, note: WITH_DATA | at(49909, 236) }, // no-wrapper-object-types bannedClassType
    Row { help: at(27564, 58), first_label: at(27622, 25), note: 0 }, // no-duplicate-imports import
    Row { help: WITH_DATA | at(31785, 64), first_label: WITH_DATA | at(31849, 51), note: 0 }, // no-global-assign globalShouldNotBeModified
    Row { help: 0, first_label: 0, note: at(20132, 97) }, // no-anonymous-default-export
    Row { help: at(27480, 59), first_label: at(27539, 25), note: 0 }, // no-duplicate-imports exportAs
    Row { help: at(23750, 46), first_label: 0, note: at(23796, 54) }, // no-confusing-array-with
    Row { help: at(23205, 71), first_label: 0, note: at(23276, 59) }, // no-clone-element
    Row { help: at(27044, 36), first_label: at(27080, 25), note: 0 }, // no-dupe-keys unexpected
    Row { help: at(32293, 103), first_label: 0, note: at(32396, 51) }, // no-img-element
    Row { help: at(4872, 203), first_label: 0, note: at(5075, 204) }, // ban-types
    Row { help: at(48506, 42), first_label: 0, note: at(48548, 88) }, // no-useless-constructor noUselessConstructor
    Row { help: at(45385, 73), first_label: at(45458, 63), note: 0 }, // no-unexpected-multiline property
    Row { help: at(45521, 86), first_label: at(45607, 63), note: 0 }, // no-unexpected-multiline taggedTemplate
    Row { help: at(26937, 79), first_label: at(27016, 28), note: 0 }, // no-dupe-else-if unexpected
    Row { help: at(47786, 94), first_label: at(47880, 9), note: 0 }, // no-use-before-define noUseBeforeDefine
    Row { help: WITH_DATA | at(55309, 49), first_label: 0, note: at(55358, 66) }, // prefer-keyboard-event-key
    Row { help: at(28788, 99), first_label: at(28887, 55), note: at(28942, 226) }, // no-ex-assign unexpected
    Row { help: 0, first_label: 0, note: at(20132, 97) }, // no-anonymous-default-export
    Row { help: at(10522, 87), first_label: at(10609, 36), note: at(10645, 104) }, // constructor-super badSuper
    Row { help: at(19372, 118), first_label: at(19490, 32), note: 0 }, // new-cap upper
    Row { help: at(34259, 59), first_label: WITH_DATA | at(34318, 33), note: 0 }, // no-label-var identifierClashWithLabel
    Row { help: WITH_DATA | at(5279, 81), first_label: 0, note: WITH_DATA | at(5360, 205) }, // ban-types
    Row { help: at(16285, 31), first_label: at(16285, 31), note: 0 }, // jsx-curly-brace-presence
    Row { help: at(26613, 53), first_label: 0, note: at(26666, 65) }, // no-document-cookie
    Row { help: at(44512, 119), first_label: 0, note: at(44631, 95) }, // no-top-level-await
    Row { help: at(25021, 73), first_label: at(25094, 54), note: 0 }, // no-constant-condition unexpected
    Row { help: at(9495, 155), first_label: 0, note: at(9650, 216) }, // consistent-type-imports typeOverValue
    Row { help: at(23850, 64), first_label: 0, note: at(23914, 69) }, // no-confusing-array-with
    Row { help: 0, first_label: at(27539, 25), note: 0 }, // no-duplicate-imports importAs
    Row { help: at(54849, 36), first_label: 0, note: at(54885, 91) }, // prefer-global-this
    Row { help: WITH_DATA | at(27146, 35), first_label: WITH_DATA | at(27181, 46), note: 0 }, // no-duplicate-enum-values duplicateValue
    Row { help: 0, first_label: at(62602, 43), note: 0 }, // unified-signatures omittingSingleParameter
    Row { help: at(7714, 213), first_label: 0, note: at(7927, 220) }, // consistent-type-assertions never
];

#[rustfmt::skip]
static TEXT: &str = concat!(
    "Define a getter for this property",
    "Define a setter for this property",
    "Move all \"{{name}}\" overload signatures together, placing them consecutively before any other members.",
    "Function overload signatures represent multiple ways a function can be called. Keeping them adjacent makes it easier for developers to understand all available call signatures at a glance.",
    "Prefer alt=\"\" over presentational role. Native HTML attributes should be preferred for accessibility before resorting to ARIA attributes.",
    "Must have meaningful value for `alt` prop. Use alt=\"\" for presentational images.",
    "Must have `alt` prop, either with meaningful text, or an empty string for decorative images.",
    "Give `aria-label` a meaningful value. Prever the `alt` attribute over `aria-label` for images.",
    "Give `aria-labelledby` an ID to a label element. Prefer the `alt` attribute over `aria-labelledby` for images.",
    "Avoid using ambiguous text like \"{{text}}\", replace it with more descriptive text that provides context.",
    "Provide screen reader accessible content when using `a` elements.",
    "Use a `button` element instead of an `a` element.",
    "Provide a correct `href` for the `a` element.",
    "Use `Math.{{method_name}}` instead.",
    "Add a `tabindex` attribute to this {{el_name}}.",
    "Try removing the prop `{{attr_name}}`.",
    "\"{{arrayMethodName}}\" uses the callback's return value. Add a `return` on every possible code path.{{value_requirement}}",
    "\"{{arrayMethodName}}\" ignores the callback's return value. Remove the returned value (use `return;` or no `return`), or use `map`/`flatMap` if you meant to produce a new array.",
    "This `switch` has no `default` case, so the callback may reach the end without a `return`. Add a `default` that returns/throws, or add a final `return` after the `switch`.{{value_requirement}}",
    "This `if` has no `else` branch, so the callback may reach the end without a `return`. Add an `else`, or add a final `return`/`throw` after the `if`.{{value_requirement}}",
    "Surround the arrow body with braces and use a return statement.",
    "Put a value of `undefined` immediately after the `=>`.",
    "Move the returned value to be immediately after the `=>`.",
    "Change `{{autocomplete}}` to a valid value for `autocomplete`.",
    "Use `async`/`await` instead, or return an existing promise from a library function.",
    "Remove `await` if the value is synchronous, or change the expression to return a Promise or Thenable before awaiting it.",
    "Use plain `using` for synchronous disposables, or change the value to implement `Symbol.asyncDispose`.",
    "Use `for...of` for synchronous iterables, or change the iterable to implement `Symbol.asyncIterator`.",
    "Pass an iterable of Promise-like values, or wrap each synchronous value in `Promise.resolve(...)` before calling the aggregator.",
    "The `arguments` object does not have a `{{method_name}}()` method. If you intended to use an array method, consider using rest parameters instead or converting the `arguments` object to an array.",
    "Bitwise operator '{{bad_operator}}' seems unintended. Did you mean logical operator '{{suggestion}}'?",
    "Character access returns a string of length at most 1. If the return value is compared with a string of length greater than 1, the comparison will always be false.",
    "Comparison result should not be used directly as an operand of another comparison. If you need to compare three or more operands, you should connect each comparison operation with logical AND operator (`&&`)",
    "Add the global flag (g) to the regular expression.",
    "`matchAll` throws a `TypeError` when passed a non-global regular expression.",
    "This comparison will always return {{const_result}} as array literals are never equal to each other. Consider using `Array.length` if empty checking was intended.",
    "This comparison will always return {{const_result}} as object literals are never equal to each other. Consider using `Object.entries()` of `Object.keys()` and comparing their lengths.",
    "To replace all occurrences of a string, use the `replaceAll` method with the global flag (g) in the regular expression.",
    "Unlike `replace`, `replaceAll` throws a `TypeError` when passed a non-global regular expression instead of replacing only the first match.",
    "Remove the @ts-{{directive}} directive and fix the underlying TypeScript error instead. If you must suppress an error, consider using @ts-expect-error with a descriptive comment explaining why it's necessary.",
    "Update the description after @ts-{{directive}} to match the required pattern: {{format}}.",
    "Add a description after @ts-{{directive}} that is at least {{minimumDescriptionLength}} characters long, explaining why the directive is necessary. For example: `// @ts-{{directive}}: TS2345 - This is a known limitation with third-party types`",
    "Requiring descriptions ensures that developers document why they're suppressing TypeScript errors, making it easier for future maintainers to understand the context and decide if the suppression is still necessary.",
    "Replace \"@ts-ignore\" with \"@ts-expect-error\".",
    "Replace `Object` with a more specific type. If you need a generic object, use `Record<string, unknown>` or define an interface/type with explicit properties. If you need any value, use `unknown` instead.",
    "The `Object` type is confusing because it doesn't mean 'any object' - it means 'any non-nullish value', which includes primitives. This makes code harder to understand and can lead to unexpected behavior.",
    "Replace \"{{banned_type}}\" with the lowercase primitive type \"{{suggested_type}}\".",
    "{{banned_type}} is a wrapper object type, while {{suggested_type}} is the primitive type. Using the primitive type is more idiomatic and avoids confusion between the object wrapper and the primitive value.",
    "The `Function` type accepts any function-like value",
    "This type means \"any non-nullish value\", which is slightly better than 'unknown', but it's still a broad type",
    "Variable '{{name}}' is used outside its declaration block. Declare it outside the block or use 'let'/'const'.",
    "Move the shared code outside the `if` statement to reduce code duplication",
    "Change the `type` attribute to one of the allowed values: {{allowed_types}}.",
    "Add a `type` attribute to the `button` element.",
    "Return the callback call or add an explicit return immediately after it.",
    "Change the first letter of the comment to uppercase",
    "Change the first letter of the comment to lowercase",
    "Valid access levels are `package`, `private`, `protected`, and `public`.",
    "There should be only one instance of access tag in a JSDoc comment.",
    "@property `{{type_name}}` is duplicated on the same block.",
    "`@property` path declaration `{{x1}}` appears before any real property.",
    "Remove either `checked` or `defaultChecked`.",
    "Add either `onChange` or `readOnly`.",
    "Replace this getter with a readonly field initialized to the returned literal.",
    "Replace this readonly literal field with a getter.",
    "Consider converting method{{name}} to a static method.",
    "Visible, non-interactive elements with click handlers must have one of `keyup`, `keydown`, or `keypress` listener.",
    "Prefer `{{assert_identifier}}.ok(...)` over `{{assert_identifier}}(...)`.",
    "Prefer passing `Date` directly to the constructor when cloning",
    "To create parameterized test with `{{fn_kind}}` function you should use `.{{method}}`",
    "Replace index check with strict equality check",
    "Move `{{name}}` to the outer scope to avoid recreating it on every call.",
    "Move the type annotation to the constructor",
    "Move the generic type to the type annotation",
    "Use an index signature such as `{ [key: string]: unknown }` instead of a record type.",
    "Use a record type such as `Record<string, unknown>` instead of an index signature.",
    "Use '\\${' to escape '${' in template literals.",
    "Rename the file that match the pattern {{pattern}}",
    "Prefer using \"{{preferred_method}}\" instead of \"{{other_method}}\"{{within}}",
    "Replace `as {{cast}}` with `<{{cast}}>`. For example, change `value as {{cast}}` to `<{{cast}}>value`.",
    "Remove the type assertion and use a type annotation instead. For example, change `const x = value as Type` to `const x: Type = value`. Alternatively, use the `satisfies` operator: `const x = value satisfies Type`.",
    "Type assertions bypass TypeScript's type checking and can hide type errors. Using type annotations or the `satisfies` operator provides better type safety while still allowing TypeScript to infer types where appropriate.",
    "Replace the array literal type assertion with a type annotation. For example, change `const x = [1, 2] as Type[]` to `const x: Type[] = [1, 2]`. Alternatively, use `const x = [1, 2] satisfies Type[]` if you want TypeScript to infer the exact array type.",
    "Type assertions on array literals can hide errors where the array doesn't actually match the asserted type. Using type annotations or `satisfies` ensures TypeScript verifies that the array matches the expected type.",
    "Replace the object literal type assertion with a type annotation. For example, change `const x = { a: 1 } as Type` to `const x: Type = { a: 1 }`. Alternatively, use `const x = { a: 1 } satisfies Type` if you want TypeScript to infer the exact shape.",
    "Type assertions on object literals can hide errors where the object doesn't actually match the asserted type. Using type annotations or `satisfies` ensures TypeScript verifies that the object matches the expected type.",
    "Try adding the `type` keyword: `type {{exportNames}}`",
    "Use `export type`.",
    "Replace the `import type` declaration with a regular `import` declaration. For example, `import type { Type } from 'module'` would become `import { Type } from 'module'`.",
    "Replace `import()` type annotations with a regular type import. For example, change `type T = import('module').Type` to `import type { Type } from 'module'; type T = Type`.",
    "Replace the `import` declaration with `import type`. For example, change `import { Type } from 'module'` would become `import type { Type } from 'module'`.",
    "Using `import type` for type-only imports helps with tree-shaking, makes it clear that these imports don't affect runtime code, and can improve build performance by allowing bundlers to eliminate unused type imports.",
    "Replace inline type specifiers with a top‐level import type statement.",
    "Replace top‐level import type with an inline type specifier.",
    "Replace inline type specifiers with a top-level import type statement.",
    "Prefer using `{{function}}` instead of `{{opposite}}`.",
    "This logical expression will always evaluate to the same value as either side.",
    "This logical expression will always evaluate to the same value as the expression itself.",
    "if `{{rhs_str}}` evaluates to true, `{{lhs_str}}` will always evaluate to true as well",
    "if `{{lhs_str}}` evaluates to true, `{{rhs_str}}` will always evaluate to true as well",
    "Because `{{left}}` will {{how_often}} be {{relation}} itself",
    "Remove the `super()` call or change the `extends` clause to a constructable superclass.",
    "This `super()` call is invalid here.",
    "`super()` calls the constructor of the superclass, but this class does not extend a constructable value.",
    "Remove the duplicate `super()` call",
    "This path may call `super()` after it was already called.",
    "Add a `super()` call to the constructor",
    "Ensure `super()` is called in all code paths",
    "Add a text label to the control element. This can be done by adding text content, an `aria-label` attribute, or an `aria-labelledby` attribute.",
    "Does {{imported_name}} have the default export?",
    "Add a `default` case.",
    "Default clause should be the last clause.",
    "Enforce default parameters to be last.",
    "Add a `displayName` property to the component.",
    "Add a `displayName` property to the context.",
    "This logical expression can be simplified. Try using the `{{operator}}` operator instead.",
    "There should be no spaces or new lines inside a pair of empty braces as it affects the overall readability of the code.",
    "`@{{tag_name}}` tag should not have body.",
    "Prefer {{expectedOperator}} operator",
    "This is most likely not the intended outcome. Consider removing the operation, or directly assigning zero to the variable",
    "The first argument to an error constructor should be a string describing the error.",
    "Provide a non-empty string that describes what went wrong.",
    "A descriptive message makes the error easier to debug when it is caught or logged.",
    "Consider putting the asynchronous code inside a function and calling it from the effect.",
    "Remove the dependency from the dependency array.",
    "Consider adding an empty list of dependencies to make it clear which values are intended to be stable.",
    "Did you forget to pass an array of dependencies?",
    "Extract the expression to a separate variable so it can be statically checked.",
    "Either include it or remove the dependency array.",
    "Consider removing it from the dependency array. Outer scope values aren't valid dependencies because mutating them doesn't re-render the component.",
    "Pass an inline function instead.",
    "Use an array literal as the second argument.",
    "Try memoizing this variable with `useRef` or `useCallback`.",
    "Did you forget to pass a callback to the hook?",
    "Remove the literal from the array.",
    "The ref value will likely have changed by the time this effect cleanup function runs. If this ref points to a node rendered by react, copy it to a variable inside the effect and use that variable in the cleanup function.",
    "Remove the duplicate dependency from the array.",
    "Add assertion(s) in this Test",
    "Require explicit return types on functions and class methods.",
    "Add an explicit 'public', 'private', or 'protected' modifier. Members without a modifier are implicitly public, which may not be intentional.",
    "Remove the 'public' modifier. Members are public by default, so the modifier is redundant.",
    "Avoid explicit `any` at module boundaries; prefer `unknown` and narrow before use.",
    "Define an explicit argument type for each argument.",
    "Define an explicit return type for the function.",
    "Add an explicit delay argument.",
    "Remove the explicit `0` delay argument.",
    "Rename or remove the duplicate export so each name is exported only once.",
    "Remove the `export *` re-export, or add named exports to the target module.",
    "Move this export to the end of the file, after all other statements.",
    "Use `module.exports` instead.",
    "Use `exports` instead.",
    "Do not modify `exports` itself.",
    "Remove the file extension from this {{import_or_export}}.",
    "Add a file extension to this {{import_or_export}}.",
    "Move import statement to the top of the file",
    "Move absolute import above relative import",
    "Use `while` loop for intended infinite loop",
    "Add a `ref` parameter, or remove `forwardRef`",
    "Rename the function or the variable/property so the names satisfy this rule.",
    "Remove the name on this function expression.",
    "Consider giving this function expression a name.",
    "Enforce the consistent use of either `function` declarations or expressions assigned to variables",
    "Return a value from all code paths in getter.",
    "Move require() to top-level module scope",
    "See https://nextjs.org/docs/messages/google-font-display",
    "See: https://nextjs.org/docs/messages/google-font-preconnect",
    "Combine multiple assignments into a single `module.exports = { ... }` statement",
    "Use a single export declaration with multiple specifiers: `export { spec1, spec2 }`",
    "Require grouped accessor pairs in object literals and classes",
    "The body of a for-in should be wrapped in an if statement to filter unwanted properties from the prototype.",
    "Handle the error or rename the parameter if it's not an error.",
    "Provide screen reader accessible content when using heading elements.",
    "Move this hoisted API to the top of the file to better reflect its behavior.\nYou may alternatively replace `vi.mock()` with `vi.doMock`, which is not hoisted.",
    "Follow the [thing, setThing] naming convention",
    "Destructure useState call into value + setter pair follow the [thing, setThing] naming convention",
    "Add a `lang` attribute to the `html` element whose value represents the primary language of document.",
    "Must have meaningful value for `lang` prop.",
    "Provide `title` property for `iframe` element.",
    "Remove `allow-scripts` or `allow-same-origin`.",
    "Check this link for the valid values of `sandbox` attribute: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sandbox.",
    "Add a `sandbox` attribute to the `iframe` element.",
    "Provide no redundant alt text for image. Screen-readers already announce `img` tags as an image. You don't need to use the words `image`, `photo`, or `picture` (or any specified custom words) in the `alt` prop.",
    "Add `@class` tag or use class syntax.",
    "Require or disallow initialization in variable declarations",
    "See https://nextjs.org/docs/messages/inline-script-id",
    "Add `tabIndex={0}` or `tabIndex={-1}` to make the element focusable.",
    "Add `tabIndex={0}` to make the element reachable via sequential keyboard navigation.",
    "Wrap this value in curly braces",
    "Rename the file with a good extension.",
    "Use `<></>` instead of `<React.Fragment></React.Fragment>`.",
    "Use `<React.Fragment></React.Fragment>` instead of `<></>`.",
    "To avoid conflicting with React's new JSX transform: https://reactjs.org/blog/2020/09/22/introducing-the-new-jsx-transform.html",
    "Each child in a list should have a unique 'key' prop",
    "Add a \"key\" prop to the element in the iterator (https://react.dev/learn/rendering-lists#keeping-list-items-in-order-with-key).",
    "Wrap the `value` prop in useMemo() or useCallback(), or use a constant value to prevent unnecessary re-renders.\nAlternatively, move the value outside the render function if it doesn't depend on props or state.",
    "Remove one of the props, or rename them so each prop is distinct.",
    "simplify props or memoize props in the parent component (https://react.dev/reference/react/memo#my-component-rerenders-when-a-prop-is-an-object-or-array).",
    "Wrap this text in a JSX expression container, such as a call to a translation function.",
    "Replace this string literal with a non-literal expression, such as a call to a translation function.",
    "This attribute is listed in `restrictedAttributes`; replace its string literal value with a non-literal expression.",
    "Use event handlers instead if you can.",
    "add rel=`noreferrer` to the element",
    "add rel=`noreferrer` or rel=`noopener` to the element",
    "Remove all but one spread.",
    "Either give the label a `htmlFor` attribute with the id of the associated control, or wrap the label around the control.",
    "Ensure the label either has text inside it or is accessibly labelled using an attribute such as `aria-label`, or `aria-labelledby`. You can mark more attributes as accessible labels by configuring the `labelAttributes` option.",
    "Set a valid value for `lang` attribute.",
    "Reduce the number of classes in this file",
    "Reduce the number of dependencies in this file",
    "Consider refactoring your code.",
    "Too many assertion calls ({{count}}) - maximum allowed is {{max}}",
    "Maximum allowed is {{max}}.",
    "Consider splitting it into smaller functions.",
    "Reduce nesting with promises or refactoring your code.",
    "Extract intermediate results into named variables to reduce nesting.",
    "Too many nested describe calls ({{current}}) - maximum allowed is {{max}}",
    "This rule enforces a maximum number of parameters allowed in function definitions.",
    "Consider refactoring the component to reduce the number of props that are needed.",
    "Media elements such as `<audio>` and `<video>` must have a `<track>` for captions.",
    "Replace the method signature with a property whose type is a function type.",
    "Replace the property signature with method shorthand syntax.",
    "Did you mean `{{suggestion}}`?",
    "The `throw` keyword seems to be missing in front of this 'new' expression",
    "Try to add `onBlur`.",
    "Try to add `onFocus`.",
    "Does {{module_name}} have the export {{imported_name}}?",
    "Imported namespace members are read-only. Assign to a local variable instead.",
    "Use a static property access (e.g. `namespace.name`) instead of a computed one.",
    "Capitalize the first letter of the constructor name, or add it to the exceptions list if it should not be capitalized.",
    "This should be uppercase",
    "Use the new operator when calling this function, or add it to the exceptions list if it should not be called with new.",
    "This should be called with `new`",
    "See https://nextjs.org/docs/messages/next-script-for-ga",
    "Replace the absolute path with a relative path or a module alias.",
    "Specify the rules you want to disable.",
    "Remove the `accessKey` attribute. Inconsistencies between keyboard shortcuts and keyboard commands used by screen readers and keyboard-only users create accessibility complications.",
    "Remove this property access, or remove `{{method_kind}}` from the method",
    "Using spreads within accumulators leads to `O(n^2)` time complexity.",
    "Use a custom UI instead",
    "Replace \"{{name}}\" with its canonical name of \"{{canonical_name}}\"",
    "Expected imports instead of AMD {{name}}()",
    "Named default exports improve grepability and enable consistent auto-imports across the codebase.",
    "Remove `aria-hidden=\"true\"` from focusable elements or modify the element to be not focusable.",
    "Wrap the function in an arrow function to explicitly pass only the element argument",
    "Use array literal notation [] instead.",
    "Use `Array.from({ length: n }, () => /* new value */)` or `.map(() => /* new value */)` to create a distinct value for each element.",
    "Use a unique data-dependent key to avoid unnecessary rerenders",
    "Use arrow functions or lexical scoping instead of passing 'thisArg' as a second argument to array methods like map, filter, etc.",
    "Refactor your code to use `for` loops instead.",
    "`Array#reverse()` mutates the original array. Use `Array#toReversed()` to return a new reversed array without modifying the original.",
    "`Array#sort()` mutates the original array. Use `Array#toSorted()` to return a new sorted array without modifying the original.",
    "Use a regular function or method shorthand instead of an arrow function.",
    "See https://nextjs.org/docs/messages/no-assign-module-variable",
    "Remove the `async` keyword",
    "See: https://nextjs.org/docs/messages/no-async-client-component",
    "Wrap the async handler and forward errors to `next()` (e.g. `(req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)`).\nExpress does not automatically handle rejected promises from async handlers, which results in unhandled promise rejections and server crashes.",
    "If you're on Express 5, disable this rule. To allow specific functions, add their names to `allowedNames`.",
    "Remove the `async` keyword from the Promise executor function.",
    "Remove the `autoFocus` attribute.",
    "Assign the result of the await expression to a variable, then access the member from that variable.",
    "Collect all promises into an array and use `Promise.all()` to run them in parallel, rather than awaiting each one sequentially inside the loop.",
    "Remove the `await`",
    "Consider importing directly from the specific modules instead of using `export *` or `import *`.\nLoading {{total}} modules may be slow for runtimes and bundlers.",
    "See: https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7",
    "Consider mapping the values to a meaningful string (e.g. pick a property or call a formatter) before calling `join()`, or implementing a custom `toString()`/`toLocaleString()` on the element type.",
    "Consider picking a property (e.g. `user.name`), using a formatter (or `JSON.stringify`), or implementing a custom `toString()`/`toLocaleString()` on the type.",
    "See https://nextjs.org/docs/messages/no-before-interactive-script-outside-document",
    "bitwise operators are not allowed, maybe you mistyped `&&` or `||`?",
    "Use `then` and `catch` directly",
    "`caller`, `callee`, and `arguments` properties may not be accessed on strict mode functions or the arguments objects for calls to them.",
    "Wrap the case body in braces `{}` to create an explicit block scope for the lexical declaration.",
    "The canonical way to pass children in React is to use JSX elements",
    "Use a different variable name instead of re-assigning the class declaration.",
    "{{name}} is declared as class here",
    "`React.cloneElement` is uncommon and leads to fragile React components.",
    "https://react.dev/reference/react/cloneElement#alternatives",
    "Remove or uncomment this test.",
    "Do not use CommonJS `require` calls and `module.exports` or `exports.*`",
    "Use Object.is(x, -0) to test equality with -0 and use 0 for other cases",
    "Consider wrapping the assignment in additional parentheses",
    "Avoid calling `expect` conditionally",
    "Replace conditionals with separate test cases for each branch to keep tests deterministic and easy to understand.",
    "Remove the surrounding if statement.",
    "Use `.length - 1` to replace the last element.",
    "An array's `.length` is one past its last valid index.",
    "Use a non-negative index to make the intended position explicit.",
    "`Array#with()` interprets a negative index as an offset from the end.",
    "Remove the `!`, or wrap the left-hand side in parentheses.",
    "Remove the `!`, or prefix the `=` with it.",
    "Only the last call to `jest.setTimeout` will have an effect.",
    "Move it to its own statement instead.",
    "Add braces to the arrow function.",
    "Move it before the `return` statement.",
    "Remove the `return` statement.",
    "Supported methods are: {{allowed}}.",
    "Delete this console statement.",
    "The `console.log()` method and similar methods join the parameters with a space so adding a leading/trailing space to a parameter, results in two spaces being added.",
    "Use `let` instead of `const` if you need to reassign this variable.",
    "{{name}} is declared here as `const`.",
    "Const enums are not supported by bundlers and are incompatible with the isolatedModules mode. Their use can lead to import nonexistent values (because const enums are erased).",
    "These two values can never be equal",
    "This compares constantly with the {{otherSide}}-hand side of the {{operator}}",
    "Both sides of the {{operator}} are literal values",
    "This expression always evaluates to the constant on the left-hand side",
    "Update the condition to not be constant, or remove the condition entirely",
    "this expression will always evaluate to the same value",
    "Remove the return statement from the constructor. If you need early exit, use a bare `return;` with no value.",
    "Do not use the `continue` statement.",
    "Avoid matching control characters in regular expressions. If intentional, disable this rule for the expression.",
    "See https://nextjs.org/docs/messages/no-css-tags",
    "`dangerouslySetInnerHTML` is a way to inject HTML into your React component. This is dangerous because it can easily lead to XSS vulnerabilities.",
    "`dangerouslySetInnerHTML` is not compatible with also passing children and React will throw a warning at runtime.",
    "Remove the debugger statement",
    "Replace this default export with a named export.",
    "{{what}} are not permitted on `@{{tag_name}}` tag.",
    "Assign `undefined` to the variable instead of using `delete`. The `delete` operator is intended for removing properties from objects, not for variables.",
    "Use a function declaration instead.",
    "Replace `{{deprecated}}` with `{{replacement}}`.",
    "Using external library instead, for example mitt.",
    "Updating state after a component mount triggers a second render() call and can lead to property/layout thrashing.",
    "Updating state after a component update triggers a second render() call and can lead to property/layout thrashing.",
    "Calling `setState()` afterwards will replace the mutations you made via `this.state`.",
    "Remove pending() call",
    "Add function argument",
    "Replace the `<{{element}}>` element with alternative, more accessible ways to achieve your desired visual effects.",
    "Rewrite `/=` into `/[=]`",
    "Use the Cookie Store API or a cookie library instead.",
    "https://developer.mozilla.org/en-US/docs/Web/API/Cookie_Store_API",
    "Prevent importing `next/document` outside of `pages/_document.js`.",
    "The last declaration overwrites previous ones, remove one of them or rename if both should be retained",
    "\"{{name}}\" is previously declared here",
    "Remove or modify the duplicate condition, as its branch will never be executed.",
    "condition first checked here",
    "Consider removing the duplicated key",
    "Key is first defined here",
    "Remove the duplicated case",
    "This label here",
    "Give {{second_name}} a unique value",
    "{{value}} is first used as an initializer here",
    "Only use a single `<Head />` component in your custom document in `pages/_document.js`. See: https://nextjs.org/docs/messages/no-duplicate-head",
    "Describe blocks can only have one of each hook. Consider consolidating the duplicate hooks into a single call.",
    "Merge the duplicated exports into a single export statement",
    "This export is duplicated",
    "Merge the duplicated import into a single import statement",
    "This import is duplicated",
    "Merge these imports into a single import statement",
    "Use a static property key, or use a Map/Set for dynamic keys.",
    "Frequent property deletions can move objects to slower dictionary-mode properties and hurt inline-cache optimizations. See: https://v8.dev/blog/fast-properties.",
    "Replace the argument with a literal string or immutable template literal",
    "Remove the `else` block, moving its contents outside of the `if` statement.",
    "Remove this {{type}} or add a comment inside it",
    "Remove the empty character class: `[]`",
    "Delete this file or add some code to it.",
    "Consider removing this {{fn_kind}} or adding logic to it.",
    "Add members to this interface, or use a type alias if it is intentionally empty.",
    "Remove this interface and use the extended type directly or add members to this interface.",
    "To avoid confusion around the {} type allowing any non-nullish value, this rule bans usage of the {} type.",
    "Remove this empty block or add content to it.",
    "Use '{{suggested_operator}}' to compare with null",
    "Avoid eval(). For JSON parsing use JSON.parse(); for dynamic property access use bracket notation (obj[key]); for other cases refactor to avoid evaluating strings as code.",
    "Remove the assignment to the exception parameter, or refactor the code to use a different variable.",
    "this assignment destroys access to the caught exception",
    "If code in a catch block assigns a value to the exception parameter, it becomes impossible to refer to the error. Since there is no alternative way to access to this data, assignment of the parameter is absolutely destructive.",
    "Use `unknown` instead, this will force you to explicitly, and safely, assert the type is correct.",
    "If you want to share code between tests, move it into a separate file and import it from there.",
    "Use 'module.exports' instead.",
    "`expose` should be called synchronously in `setup()` (or `defineExpose()` in `<script setup>`). Move the call before the first `await`.",
    "Consider using a utility function or a class that extends the built-in object instead of defining properties on the prototype.",
    "Remove the `.bind` call.",
    "Remove the Boolean call as it will already be coerced to a boolean",
    "Remove the double negation as it will already be coerced to a boolean",
    "Remove this label. It will have the same result because the labeled statement '{{name}}' has no nested loops or switches",
    "Remove the redundant non-null assertion operator (`!`).",
    "The non-null assertion operator in TypeScript, written as `!`, tells the compiler that an expression is definitely not `null` or `undefined` at that point. Chaining multiple non-null assertions on the same expression does not provide any additional safety and is redundant.",
    "Delete this class",
    "Try replacing this class with a standalone function or deleting it entirely",
    "Try using standalone functions instead of static methods",
    "Use a `break` statement to prevent fallthrough, or add a comment to indicate intentional fallthrough.",
    "Remove the fallthrough comment or add code that allows fallthrough (e.g. remove `break`).",
    "Replace `findDOMNode` with one of the alternatives documented at https://react.dev/reference/react-dom/findDOMNode#alternatives.",
    "The promise must end with a call to .catch, or end with a call to .then with a rejection handler.",
    "Consider handling the promises' fulfillment or rejection with Promise.all or similar.",
    "Consider handling the promises' fulfillment or rejection with Promise.all or similar, or explicitly marking the expression as ignored with the `void` operator.",
    "The promise must end with a call to .catch, or end with a call to .then with a rejection handler. A rejection handler that is not a function will be ignored.",
    "The promise must end with a call to .catch, or end with a call to .then with a rejection handler, or be explicitly marked as ignored with the `void` operator. A rejection handler that is not a function will be ignored.",
    "The promise must end with a call to .catch, or end with a call to .then with a rejection handler, or be explicitly marked as ignored with the `void` operator.",
    "Remove focus from test.",
    "Use a more robust iteration method such as for-of or array.forEach instead.",
    "Do not re-assign a function declared as a FunctionDeclaration.",
    "{{name}} is re-assigned here",
    "Use a local variable instead of modifying the global '{{name}}'.",
    "Read-only global '{{name}}' should not be modified.",
    "See https://nextjs.org/docs/messages/no-head-element",
    "See https://nextjs.org/docs/messages/no-head-import-in-document",
    "Inline the setup or teardown logic directly in each test for better readability and isolation.",
    "Use `<Link />` from `next/link` instead for internal navigation. See https://nextjs.org/docs/messages/no-html-link-for-pages",
    "Change the title of describe block.",
    "Change the title of test.",
    "Consider using `<Image />` from `next/image` or a custom image loader to automatically optimize images.",
    "See https://nextjs.org/docs/messages/no-img-element",
    "Move the property into the object initializer.",
    "Add the element to the Set initializer array.",
    "Add the entry to the Map initializer array.",
    "Move the properties from `Object.assign()` into the object initializer.",
    "Move the elements from `{{method}}()` into the array initializer.",
    "Wrap it in a block or in an IIFE.",
    "Wrap it in an IIFE for a local variable, or assign it as a global property for a global variable.",
    "Declare the variable if it is intended to be local.",
    "Avoid executing source text at runtime.",
    "Pass a function callback instead of source text.",
    "Consider passing a function.",
    "Imported bindings are readonly",
    "Remove the import statement for this macro.",
    "Import from `vitest` instead.",
    "Convert this to a top-level type qualifier to properly remove the entire import.",
    "You can import anything except `suite, test, chai, describe, it, expectTypeOf, assertType, expect, assert, vitest, vi, beforeAll, afterAll, beforeEach, afterEach, onTestFailed, onTestFinished`.",
    "Remove the type annotation",
    "Move the comment to a separate line",
    "Move {{type}} declaration to {{body}} root",
    "The instanceof Array check doesn't work across realms/contexts, for example, frames/windows in browsers or the vm module in Node.js.",
    "Use `Array.isArray(…)`, `typeof … === 'string'`, or another realm-safe alternative instead",
    "WAI-ARIA roles should not be used to convert an interactive element to a non-interactive element. Wrap the element or use a different structure.",
    "Remove string interpolation from snapshots",
    "The listener argument should be a function reference.",
    "Replace this `void` type with an allowed type, or keep `void` only in a valid return position.",
    "Try to remove the irregular whitespace",
    "`isMounted` is not supported in modern React, and does not work in class or function components.",
    "Consider using [Symbol.iterator] instead",
    "\"prefer use Jest own API `{{api}}`\"",
    "Rename either the variable or the label to avoid confusion.",
    "Identifier '{{name}}' found here.",
    "Consider refactoring the code to eliminate the need for labels.",
    "Remove the second argument.",
    "Lifecycle hooks should be called synchronously in `setup()`. Move the hook call before the first `await`.",
    "Remove the unnecessary block statement. If you need to limit variable scope, consider using a function or module instead.",
    "Remove the redundant nested block statement.",
    "Move the inner `if` test to the outer `if` test.",
    "Consider using `else if` instead.",
    "Variables declared with 'var' are function-scoped, not block-scoped. Consider using 'let' or 'const' for block-scoped variables, or move the function outside the loop.",
    "Use a number literal representable by a 64-bit floating-point number, or use a `BigInt` literal (for example, `9007199254740993n`) for exact large integers.",
    "In JavaScript, `Number` values exactly represent integers only in the range -9007199254740991 to 9007199254740991 (`Number.MIN_SAFE_INTEGER` to `Number.MAX_SAFE_INTEGER`). `BigInt` supports arbitrarily large integers.",
    "Add a comment explaining the depth.",
    "Use a named constant instead of a magic number to make the code more readable and maintainable.",
    "Use 'const' instead of 'let' or 'var' to declare number constants to make their immutability explicit.",
    "If in-place mutation is acceptable, use `push` (or `concat` when semantics match) instead of spreading",
    "`push` mutates the array. `concat` returns a new array and is not equivalent for every iterable.",
    "If in-place mutation is acceptable, use `Object.assign` or direct property assignment instead of spreading",
    "`Object.assign` mutates the first argument. Disable this rule if copy-on-write behavior is required.",
    "Replace the character with its normalized form (NFC) or use Unicode code point escapes instead of combining sequences.",
    "Use Unicode code point escapes (e.g., \\u{1F3FB} for the light skin tone modifier) instead of emoji modifier sequences in character classes.",
    "Use Unicode code point escapes (e.g., \\u{1F1EF} for the regional indicator symbol for 'J') instead of regional indicator symbol pairs in character classes.",
    "Use Unicode code point escapes (e.g., \\u{1F44D}) instead of surrogate pairs.",
    "Add the Unicode flag 'u'.",
    "Use Unicode code point escapes (e.g., \\u{1F468}\\u200D\\u{1F469} for '👨‍👩') instead of zero-width joiner sequences in character classes.",
    "This method name is confusing, consider renaming the method to `constructor`",
    "Consider removing this method from your interface.",
    "Did you forget to call the function?",
    "Did you mean to use `Object.fromEntries(map)` instead?",
    "Did you forget to await the promise before spreading it?",
    "Consider using `Intl.Segmenter` for locale-aware string decomposition. Otherwise, if you don't need to preserve emojis or other non-ASCII characters, disable this lint rule on this line or configure the 'allow' rule option.",
    "Instead use `jest.mock` or `vi.mock` and import from the original module path.",
    "Separate each assignment into its own statement",
    "Move this component to a separate file.",
    "Multiline strings are not allowed. Use template literals or string concatenation instead.",
    "Pass only one argument to the slot function.",
    "Do not use spread arguments when calling slot functions.",
    "Replace '{{kind}}' with 'const' to export an immutable binding.",
    "Using default import as {{module_name}} can be confusing. Use another name for default import to avoid confusion.",
    "Check if you meant to write `import { {{export}} } from {{suggested_module_name}}`",
    "Forbid named default exports.",
    "Replace named exports with a single export default to ensure a consistent module entry point.",
    "Use named or default imports",
    "Replace the namespace with an ES2015 module or use `declare module`",
    "Remove the negation operator and switch the consequent and alternate branches.",
    "Remove the negation operator and use '{{suggested_operator}}' instead of '{{current_operator}}'.",
    "Avoid nesting ternary expressions for more than one level.",
    "Add parentheses around the nested ternary expression.",
    "Refactor nested ternary expressions into if-else statements for better readability.",
    "Refactor so that promises are chained in a flat manner.",
    "Assign the result of 'new' to a variable or compare it to a reference.",
    "It's not clear whether the argument is meant to be the length of the array or the only element. If the argument is the array's length, consider using `Array.from({ length: n })`. If the argument is the only element, use `[element]`.",
    "`new Buffer()` is deprecated, use `Buffer.alloc()` or `Buffer.from()` instead.",
    "Avoid the `Function` constructor. Define the function directly with a function declaration/expression or an arrow function.",
    "Dynamic function construction is used here.",
    "The `Function` constructor compiles code from strings at runtime, which can introduce injection risks, hurts performance, and makes code harder to analyze and maintain.",
    "Remove the `new` operator to call `{{name}}` as a function.",
    "Separate `require()` from `new` operator",
    "`Promise.{{static_name}}` is not a constructor. Call it as a function instead.",
    "Remove the `new` operator.",
    "Use a browser-compatible alternative or add this module to the `allow` list if Node.js usage is intentional.",
    "The nullish coalescing operator is designed to handle undefined and null - using a non-null assertion is not needed.",
    "Remove the non-null assertion.",
    "non-null assertion made after optional chain",
    "The non-null assertion operator (`!`) removes `null` and `undefined` from the type. For example, it changes `number | undefined` to `number`.",
    "Move the handler to an interactive element, or use an appropriate interactive role.",
    "Remove the interactive role or use an appropriate interactive element instead.",
    "The `tabIndex` attribute should be removed.",
    "Use the actual character or a valid escape sequence instead.",
    "This call will throw a TypeError at runtime.",
    "Use object literal notation {} instead",
    "Default values are re-created on every render and break referential equality, causing unnecessary re-renders. Move the value out of the component or memoize it.",
    "See: https://nextjs.org/docs/messages/no-page-custom-font",
    "See: 'https://nextjs.org/docs/messages/no-page-custom-font",
    "Consider using a different variable to avoid unintended side effects on the parameter.",
    "Consider using a different variable to avoid unintended side effects on the parameter's properties.",
    "Replace string concatenation of `__dirname` or `__filename` with `path.join()` or `path.resolve()`.",
    "Use the assignment operator `{{sign}}=` instead.",
    "Remove usage of `process.env`.",
    "Throw an error instead.",
    "Use `resolve()` or `reject()` instead of returning a value.",
    "Use either promises or callbacks exclusively for handling asynchronous code.",
    "use `Object.getPrototypeOf` and `Object.setPrototypeOf` instead.",
    "to avoid prototype pollution, use `Object.prototype.{{prop}}.call` instead",
    "`React.Children` is uncommon and leads to fragile React components.",
    "https://react.dev/reference/react/Children#alternatives",
    "Use a different variable name or remove the duplicate declaration.",
    "Use a different variable name to avoid shadowing the built-in global.",
    "Remove the redundant role `{{role}}` from the element `{{element}}`.",
    "Use a quantifier: ` {{{length}}}`",
    "Move the file to the same directory, use dependency injection, or convert to a package.",
    "Using the return value is a legacy feature.",
    "Do not use CommonJS `require` calls",
    "Remove the `required: true` option, or drop the `required` key entirely to make this prop optional.",
    "Use named export instead.",
    "Rename this export.",
    "Use a local variable or function parameter instead of the restricted global.",
    "{{customMessage}}",
    "{{message}}",
    "{{help}}",
    "Compute the value before returning it, or wrap the assignment in parentheses to make the intent explicit.",
    "Remove the return statement as nothing can consume the return value",
    "Return the value being passed into Promise.resolve instead",
    "Throw the value being passed into Promise.reject instead",
    "See https://nextjs.org/docs/messages/no-script-component-in-head",
    "Execute the code directly instead.",
    "Remove the self-assignment or assign to a different variable.",
    "If you are testing for NaN, you can use the `Number.isNaN()` function.",
    "Remove this import. A module should not import itself.",
    "Do not use the comma operator. If you intended to write a sequence, wrap it in parentheses.",
    "Remove the return statement or ensure it does not return a value.",
    "Consider renaming '{{name}}' to avoid shadowing the variable from the outer scope.",
    "'{{name}}' is declared here",
    "Enum members are added to the enum scope, so references to '{{name}}' in enum member initializers resolve to this member instead of the declaration in the upper scope.",
    "Consider renaming '{{name}}' to avoid shadowing the global variable.",
    "Rename '{{name}}' to avoid shadowing the global property.",
    "Either use the value directly, or switch to `Promise.resolve(…)`.",
    "remove the comma or insert `undefined`",
    "Did you forget to wrap `expect` in a `test` or `it` block?",
    "Add a role attribute to this element, or use a semantic HTML element instead.",
    "Convert to an object instead of a class with only static members.",
    "Using reference callback instead",
    "Using this.xxx instead of this.refs.xxx",
    "Possible to fix it please see: https://nextjs.org/docs/messages/no-styled-jsx-in-document#possible-ways-to-fix-it",
    "See https://nextjs.org/docs/messages/no-sync-scripts",
    "Did you mean to use a template string literal?",
    "Do not use the ternary expression.",
    "Use `await` for async assertions or remove the return statement.",
    "Jest ignores returned values from tests.",
    "If an object is defined as 'thenable', once it's accidentally used in an await expression, it may cause problems",
    "Assigning a variable to this instead of properly using arrow lambdas may be a symptom of pre-ES2015 practices or not managing scope well.",
    "Disabling destructuring of this is not a default, consider allowing destructuring",
    "Reference `this` directly instead of assigning it to a variable.",
    "Call `super()` before `this`/`super` property access.",
    "Use the callback's `vm` parameter instead of `this` in `beforeRouteEnter`.",
    "Remove `this` or convert to a non-exported function. In bundlers, `this` becomes `undefined` in exported functions.",
    "Use props and context directly as function parameters instead of accessing them through `this`",
    "Throwing literals or non-Error objects is not recommended. Use an Error object instead.",
    "See https://nextjs.org/docs/messages/no-title-in-document-head",
    "Move the `await` inside an `async` function, as ES modules with top-level `await` cannot be loaded with `require(esm)`.",
    "This rule is intended for published packages. Consider disabling it if this package is private.",
    "Change `{{typo}}` to `{{suggestion}}`",
    "Consider assigning the import to a variable or removing it if it's unused.",
    "Variable declared without assignment. Either assign a value or remove the declaration.",
    "Either define '{{name}}' or remove the reference to it. If '{{name}}' is a global variable, add it to the 'globals' configuration.",
    "Remove the dangling '_' or add `{{identifier}}` to the 'allow' configuration.",
    "If you did not intend to divide, insert ';' before the slash",
    "this is parsed as division, which may be unintentional",
    "If you did not intend to make a function call, insert ';' before the parenthesis",
    "this is parsed as a function call, which may be unintentional",
    "If you did not intend to access a property, insert ';' before the bracket",
    "this is parsed as a property access, which may be unintentional",
    "If you did not intend for this to be a tagged template, insert ';' before the backtick",
    "this is parsed as a tagged template, which may be unintentional",
    "Remove the argument",
    "Omit the argument to delete all elements after the start index.",
    "Consider removing the `await`",
    "Remove the unnecessary assignment",
    "Consider omitting the unnecessary end argument.",
    "Remove the unnecessary \"{{constraint}}\" constraint",
    "Remove the async wrapper and pass the promise directly to expect",
    "Remove this ternary operator and use the variable directly",
    "Remove this ternary operator",
    "Remove the unreachable code or fix the control flow to make it reachable.",
    "Remove the loop or make at least one path continue to the next iteration.",
    "Rewrite the IIFE to avoid having a parenthesized arrow function body.",
    "Use `{{replacement}}` instead. See https://legacy.reactjs.org/blog/2018/03/27/update-on-async-rendering.html",
    "You can try to fix this by turning on the `noImplicitThis` compiler option, or adding a `this` parameter to the function.",
    "The TypeScript compiler doesn't check whether properties are initialized, which can lead to TypeScript not detecting code that will cause runtime errors.",
    "Compare against a member of the same enum as the switch value, or normalize both sides to the same primitive representation first.",
    "Compare enum values to members of the same enum, or convert both sides to the same primitive type before comparing them.",
    "Control flow inside `try` or `catch` blocks will be overwritten by this statement.",
    "Prefer explicitly defining any function parameters and return type.",
    "Use `()` to negate the whole expression, as '!' binds more closely than '{{operator}}'",
    "This can result in NaN.",
    "If this short-circuits with 'undefined' the evaluation will throw TypeError",
    "Consider using type guards or a safer assertion.",
    "Consider using a more specific type to ensure safety.",
    "Add a type parameter to the mock factory such as `typeof import({{module_name}})`",
    "Consider using this expression or removing it",
    "Remove the declaration or use it in the code.",
    "See https://nextjs.org/docs/messages/no-unwanted-polyfillio",
    "Replace with a safe alternative like https://cdnjs.cloudflare.com/polyfill/ or use modern browser features directly. See: https://blog.cloudflare.com/polyfill-io-now-available-on-cdnjs-reduce-your-supply-chain-risk",
    "Move the declaration before any references to it, or remove the reference if it is not needed.",
    "used here",
    "Consider removing or reusing the assigned value.",
    "Consider revising the pattern to remove or relocate the backreference so it points to a group that can be matched at the time of evaluation.",
    "Replace with a normal function invocation",
    "Remove the try/catch wrapper, since it does not provide any additional error handling or functionality.",
    "Remove the catch clause, since it does not provide any additional error handling or functionality beyond what the finalizer already provides.",
    "Replace the computed property with a plain identifier or string literal",
    "Rewrite into one string literal.",
    "Remove the constructor or add code to it.",
    "Remove this constructor or add code to it.",
    "Subclasses automatically use the constructor of their superclass, making this redundant.",
    "Remove the default assignment",
    "Remove this empty export.",
    "The Error constructor already calls `captureStackTrace` internally, so calling it again is unnecessary.",
    "Spreading falsy values in object literals won't add any unexpected properties, so it's unnecessary to add an empty object as fallback.",
    "Remove `.toArray()`.",
    "Wrapping the error in `Promise.reject` is needlessly verbose. All errors thrown in async functions are already wrapped in a `Promise`.",
    "Wrapping the return value in `Promise.resolve` is needlessly verbose. All return values in async functions are already wrapped in a `Promise`.",
    "Use the variable's original name or rename it to a different name",
    "Remove this redundant `return` statement.",
    "Consider removing the spread operator.",
    "Consider removing this case or removing the `default` case.",
    "Consider removing `undefined` or using `null` instead.",
    "Replace var with let or const",
    "Use ES module imports or `import = require` instead.",
    "Use `undefined` instead",
    "Remove or rephrase this comment",
    "`watch` and `watchEffect` should be called synchronously in `setup()`. Move the call before the first `await`.",
    "Do not use import syntax to configure webpack loaders",
    "Updating state during the update step can lead to indeterminate component state and is not allowed.",
    "Do not use the `with` statement.",
    "`{{typeName}}` is a boxed object type, not a primitive. Boxed types have object semantics (identity/truthiness) that can be surprising. Use `{{preferred}}` for values, and in `extends`/`implements` use an interface/object shape instead.",
    "Replace the number literal with `{{lit}}`",
    "The first argument of 'Number.prototype.{{method_name}}' should be a number between {{min}} and {{max}}",
    "Use lowercase for `e` in exponential notations.",
    "Use uppercase for hexadecimal digits.",
    "Use lowercase for the number literal prefix `0x` and uppercase for hexadecimal digits.",
    "Use lowercase for the number literal prefix `{{prefix}}`.",
    "Group digits with numeric separators (_) so longer numbers are easier to read.",
    "Remove the argument and its usage. Alternatively, use the argument in the function body.",
    "Make sure there is an empty new line before the afterAll block",
    "Make sure there is an empty new line before the {{name}} block",
    "Remove the parameter modifier and declare this member on the class instead.",
    "Declare this member as a constructor parameter property and remove the class field plus assignment.",
    "`addEventListener()` can register multiple handlers and accepts options such as `{ once: true }`; assigning to `on<event>` replaces any previously registered handler.",
    "Use `find(predicate)` instead of `filter(predicate)[0]` or similar patterns.",
    "Call `.flat()` on the array instead.",
    "Replace `.filter(…).flatMap(…)` with a single `.flatMap(…)`.",
    "Prefer `.flatMap(…)` over `.map(…).flat()`.",
    "Use `indexOf(value)` instead of `findIndex(x => x === value)` for better clarity and performance",
    "Replace `.filter(…).length` with `.some(…)`",
    "Use an arrow function instead.",
    "You should use `as const` instead of type annotation.",
    "Use `.at()` for index access.",
    "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/at",
    "Refactor to use an `async` function with `await` instead of passing callbacks for cleaner error handling and control flow.",
    "Use `await` with `try`/`catch` instead of promise chaining for more readable and maintainable async code.",
    "Use a bigint literal (e.g. `123n`) instead of calling `BigInt` with a literal argument.",
    "Replace with `toHaveBeenCalledExactlyOnceWith` and remove redundant expect",
    "Prefer `{{without_suffix}}Once()`.",
    "Replace with `toBeCalledTimes(1)` or `toHaveBeenCalledTimes(1)` for clarity and consistency",
    "Prefer {{replacement}}(/* expected args */)",
    "Handle promise errors in a `catch` instead of using the second argument of `then`.",
    "Replace the class field declaration with the value from `this` assignment.",
    "Declare static values as class fields instead of assigning them to `this` in the constructor.",
    "Use `classList.toggle()` instead",
    "Unicode is better supported in `{{good_method}}` than `{{bad_method}}`",
    "Prefer using `\"{{preferred_method}}\"` instead",
    "Use `const` instead.",
    "Change to `Date.now()`.",
    "Prefer a default export",
    "Replace the reassignment with a default parameter.",
    "Pass the function as a description title argument or modify the description title to not match any imported function name.",
    "Use {{kind}} destructuring rather than direct member access.",
    "Replace `Node#appendChild()` with `Node#append()`.",
    "Replace `parentNode.removeChild(childNode)` with `childNode.remove()`.",
    "https://developer.mozilla.org/en-US/docs/Web/API/Element/remove",
    "Replace `.innerText` with `.textContent`.",
    "Prefer using `{{fn_name}}.each` rather than a manual loop.",
    "Add an `expect` or assertion call as the last statement in the test block.",
    "Using default numerical values for enum members can cause bugs later on if the enum is modified. Instead give \"{{name}}\" an explicit initializer (for example `= 0` or `= '{{name}}'`).",
    "TypeScript computes uninitialized enum members as numbers: the first one defaults to `0`, and each following uninitialized member is the previous numeric value plus `1`.",
    "Prefer using one of the equality matchers instead",
    "Change `EventEmitter` to `EventTarget`. EventEmitters are only available in Node.js, while EventTargets are also available in browsers.",
    "https://developer.mozilla.org/en-US/docs/Web/API/EventTarget",
    "Add `{{prefix}}.hasAssertions()` or `{{prefix}}.assertions(<number>)` as the first statement in the test.",
    "Replace this argument with a numeric literal.",
    "Add `{{prefix}}.hasAssertions()` or `{{prefix}}.assertions(<number>)` as the first statement in this test.",
    "Rename the parameter to avoid shadowing the global `expect`.",
    "Pass a single numeric argument to `{{prefix}}.assertions()`.",
    "Remove the arguments from `{{prefix}}.hasAssertions()`.",
    "Use `await expect(...).resolves` instead",
    "Substitute the assertion with `{{code}}`.",
    "https://vitest.dev/api/expect#tobetypeof",
    "Replace `Math.pow(a, b)` with `a ** b`.",
    "use `export ... from ...;`",
    "Consider using a `for...of` loop for this simple iteration.",
    "Convert the class component to a function component.",
    "See https://react.dev/reference/react/Component#migrating-a-simple-component-from-a-class-to-a-function",
    "The function type form `{{suggestion}}` is generally preferred when possible for being more succinct.",
    "Replace the alias with `globalThis`.",
    "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/globalThis",
    "\"{{hook}}\" hooks should be before any \"{{previous_hook}}\" hooks",
    "Hooks should come before test cases",
    "Dynamic import improves the type information and IntelliSense. Substitute `{{path}}` with `import('{{path}}')`",
    "Replace this expression with `import.meta.dirname`.",
    "Replace this expression with `import.meta.filename`.",
    "Prefer `jest.mocked()`",
    "The `{{deprecated_prop}}` property is deprecated.",
    "https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key",
    "Require all enum members to be literal values.",
    "Switch to \"||\" or \"??\" operator",
    "`{{title}}`s should begin with lowercase",
    "Prefer \"{{preferred_name}}\"",
    "Replace `{{current_property}}` with `{{replacement}}`.",
    "ES modules are always strict mode, so this directive is redundant.",
    "Prefer ES modules over CommonJS globals.",
    "Use a named capture group like \"(?<name>...)\" — this regex has {{unnamed_count}} unnamed group{{s}}.",
    "Replace `module` with `namespace` for internal declarations.",
    "`module` for internal declarations is no longer supported: treat it as a hard error. Expect it to become a parse error in a future version of TypeScript and Oxlint. See: https://github.com/microsoft/TypeScript/issues/54500, https://github.com/microsoft/TypeScript/issues/62211, https://github.com/microsoft/TypeScript/pull/62876.",
    "Replace length expression with negative index",
    "Prefer `node:{{module_name}}` over `{{module_name}}`.",
    "Replace this call with `{{replacement}}`.",
    "Replace it with `Number.{{method_name}}`",
    "Use `Object.fromEntries(pairs)` instead of manually building objects with `reduce` or `forEach`.",
    "Use an object literal instead of `Object.assign`. eg: `{ foo: bar }`.",
    "Use an object spread instead of `Object.assign` eg: `{ ...foo }`.",
    "Only pass an Error object to the reject() function for user-defined errors in Promises.",
    "It's better to use the same method to query DOM elements. This helps keep consistency and it lends itself to future improvements (e.g. more specific selectors).",
    "Mark it as `readonly`.",
    "`Reflect.apply()` is less verbose and easier to understand.",
    "`RegExp#test()` exclusively returns a boolean and therefore is more efficient.",
    "Replace `new Response(JSON.stringify(...))` with `Response.json(...)`",
    "Replace `arguments` with rest parameters (`...args`).",
    "Switch to `Set`",
    "Merge with the previous call.",
    "Provide a string literal as the hint, or pass a property matcher object as the first argument and the hint string as the second.",
    "Include a hint string to identify this snapshot in the snapshot file.",
    "The spread operator (`...`) is more concise and readable.",
    "Replace `.apply()` with spread syntax (`...args`).",
    "Use strict boolean comparison instead of truthy/falsy coercion.",
    "Use `toStrictEqual()` instead",
    "Replace with `{{good_trim}}`",
    "Switch to `structuredClone(…)`.",
    "Replace HTML elements with `role` attribute `{{role}}` to corresponding semantic HTML tag `{{tag}}`.",
    "Use template literals instead of string concatenation.",
    "Rewrite this `if`/`else` as a ternary expression.",
    "Consider using `toBeObject()` to test if a value is an object.",
    "Use `toHaveBeenCalled()` to check if function was called, or `not.toHaveBeenCalled()` to check if it wasn't called",
    "Use `toHaveBeenCalledTimes()` to assert the number of times a mock function was called",
    "Add `await` before the function call.",
    "Use \"@ts-expect-error\" to ensure an error is actually being suppressed.",
    "Change to `throw new TypeError(...)`",
    "Preserve the original error by using the `cause` property when re-throwing errors.",
    "Add an error parameter to the catch clause to access the caught error.",
    "Consider adding an explicit return type annotation if the function is intended to return a union of promise and non-promise types.",
    "The radix parameter should be an integer between 2 and 36, or a variable that is not `undefined`.",
    "Add parameters for parsing numbers, e.g., `parseInt('10', 10)`.",
    "Add radix parameter `10` for parsing decimal numbers, or specify the appropriate radix for other number formats.",
    "When using JSX, `<a />` expands to `React.createElement(\"a\")`. Therefore the `React` variable must be in scope.",
    "Add `./` prefix",
    "Remove leading `./`",
    "Missing the separator argument.",
    "Consider removing the `async` keyword.",
    "Add `await` to the `expect.{{member_name}}` call.",
    "Export the component object directly instead of assigning it to a variable first.",
    "This should be done within a hook",
    "Use local Test Context instead",
    "Add a type parameter to the mock function, e.g. `vi.{{method_name}}<() => void>()`.",
    "Remove the unused import attribute.",
    "Remove empty braces",
    "It's better to make it clear what the value of the digits argument is when calling Number#toFixed(), instead of relying on the default value of 0.",
    "Add `@param` tag with name.",
    "Add description to `@param` tag.",
    "Add root description to `@param`.",
    "Add name to `@param` tag.",
    "Add {type} to `@param` tag.",
    "https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage",
    "Consider adding a `@property` tag or replacing it with a more specific type.",
    "Add a description to this `@property` tag.",
    "Add a type name to this `@property` tag.",
    "Add a {type} to this `@property` tag.",
    "All code paths inside a render function must return a value.",
    "When writing the `render` method in a component it is easy to forget to return the JSX content. This rule will warn if the `return` statement is missing.",
    "Remove the redundant `@returns` tag.",
    "Add a `@returns` tag to the JSDoc comment.",
    "Add description comment to `@returns` tag.",
    "Add {type} to the `@returns` tag.",
    "Add a numeric third argument, a `{ timeout }` option object second argument, or call `vi.setConfig({ testTimeout: ... })` before this test.",
    "Add a `timeout` property to the options object.",
    "Use a non-negative numeric literal for the timeout value.",
    "Pass an object with a `testTimeout` property to `vi.setConfig()`.",
    "Add description comment to `@throws` tag.",
    "Add {type} to `@throws` tag.",
    "Add an error message to \"{{matcher_name}}\"",
    "Provide an explicit type parameter or an initial value.",
    "Add the 'u' flag.",
    "The 'u' and 'v' flags enable Unicode-aware regular expression behavior and stricter pattern parsing.",
    "Add the 'v' flag.",
    "Add a `yield` expression inside the generator body, or convert it to a regular function if iteration behavior is not needed.",
    "Remove redundant `@yields` tag.",
    "Add `@yields` tag to the JSDoc comment.",
    "Add description comment to `@yields` tag.",
    "Add {type} to `@yields` tag.",
    "Operands must each be a number or {{stringLike}}.",
    "Operands must both be a number or both be {{stringLike}}.",
    "All code paths inside a computed getter must return a value.",
    "Add missing aria props {{props}} to the element with `{{role}}` role.",
    "Try to remove invalid attribute `{{attr_name}}`.",
    "Move the Hook call before the condition, or call it unconditionally and branch inside the Hook/effect instead.",
    "Remove the `scope` prop on elements other than `<th>`.",
    "Make the component self closing",
    "Sort variable declarations in ascending order (case-sensitive by default).",
    "Use a more specific type to ensure type safety.",
    "Handle the nullish case explicitly.",
    "Handle the nullish and falsy enum cases explicitly.",
    "Handle the nullish and zero cases explicitly.",
    "Handle the nullish and empty string cases explicitly.",
    "Add Braces for case clause.",
    "Remove braces in empty case clause.",
    "Remove Braces for case clause.",
    "Pass a description argument to the Symbol()",
    "Change the `tabIndex` prop to a non-positive value.",
    "Using `new` ensures the error is correctly initialized.",
    "Use of triple-slash reference type directives is generally discouraged in favor of ECMAScript Module imports.",
    "Add at least one import or export statement to unambiguously mark this file as a module",
    "If your function does not access `this`, you can annotate it with `this: void`, or consider using an arrow function instead.",
    "File must begin with the Unicode BOM",
    "File must not begin with the Unicode BOM",
    "this signature can be unified",
    "this parameter only appears in one overload",
    "this parameter can be unified",
    "consider filling the array with `undefined` values using `Array.prototype.fill()`",
    "Use the `isNaN` function instead of the switch.",
    "Use the `isNaN` function to compare with NaN.",
    "Use the `isNaN` function to check for NaN values.",
    "Remove `export default`.",
    "Define at least one event in `defineEmits`.",
    "combine all events into a single `defineEmits` call.",
    "remove the argument for better type inference.",
    "inline the variable or import it from another module.",
    "Define at least one prop in `defineProps`.",
    "combine all `defineProps` calls into a single `defineProps` call.",
    "Add name as first argument and callback as second argument",
    "Remove `async` keyword",
    "Replace second argument with a function",
    "Remove argument(s) of describe callback",
    "Remove return statement in your describe callback",
    "Add `await` to your assertion.",
    "Is it a spelling mistake?",
    "Did you forget to add a matcher, e.g. `toBe`, `toBeDefined`",
    "Add the missing arguments.",
    "Remove the extra arguments.",
    "You need to call your matcher, e.g. `expect(true).toBe(true)`.",
    "Either `await` the promise, `return` it, or use `expect().resolves`/`expect().rejects`.",
    "Write a meaningful title for your test",
    "The function name already has the prefix, try to remove the duplicate prefix",
    "Remove the leading or trailing spaces",
    "Replace your title with a string",
    "Make sure the title matches the `mustMatch` of your config file",
    "Make sure the title does not match the `mustNotMatch` of your config file",
    "It is included in the `disallowedWords` of your config file, try to remove it from your title",
    "Consider moving this to the top of the functions scope or using let or const to declare this variable.",
    "Remove this element's children or use a non-void element.",
    "Write an actual test and remove the `.todo` modifier before pushing/merging your changes.",
    "Expected literal to be on the {{expectedSide}} side of {{operator}}.",
);
