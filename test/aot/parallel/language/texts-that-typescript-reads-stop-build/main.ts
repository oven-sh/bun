// Each file imported here holds one text of TypeScript's own syntax that `bun run` reports a syntax error in. TypeScript's parser reads them all, and what its
// checker says of them does not count in a file that is not checked. With all that TypeScript erases taken out, each is a program.
import "./a-comma-behind-the-last-type-argument-of-a-base-class.ts";
import "./a-reserved-word-as-a-type.ts";
import "./a-modifier-on-a-type-parameter.ts";
import "./variance-on-the-type-parameter-of-a-function.ts";
import "./variance-in-the-other-order.ts";
import "./an-index-signature-with-a-question-mark.ts";
import "./an-index-signature-without-a-type.ts";
import "./an-index-signature-of-two-parameters.ts";
import "./a-parameter-property-in-a-function-type.ts";
import "./a-parameter-property-in-an-overload.ts";
import "./an-initializer-in-a-function-type.ts";
import "./an-initializer-in-an-interface.ts";
import "./a-private-name-in-an-interface.ts";
import "./a-getter-with-a-body-in-an-interface.ts";
import "./an-interface-that-extends-nothing.ts";
import "./an-interface-that-extends-a-call.ts";
import "./a-class-that-implements-a-call.ts";
import "./a-rest-parameter-ahead-of-another-in-an-overload.ts";
import "./a-question-mark-and-an-initializer.ts";
import "./types-of-documentation-comments.ts";
import "./an-assertion-signature-as-the-type-of-a-parameter.ts";
import "./an-import-type-of-a-name.ts";
import "./declare-ahead-of-using.ts";
import "./declare-ahead-of-an-import.ts";
import "./declare-behind-abstract.ts";
import "./declare-and-async.ts";
import "./a-declared-variable-named-let.ts";
import "./a-declared-class-with-one-private-name-twice.ts";
import "./a-declared-enum-with-a-computed-name.ts";
import "./a-declared-static-field-named-prototype.ts";
import "./one-modifier-twice.ts";
import "./accessor-ahead-of-readonly.ts";
import "./abstract-on-a-parameter.ts";
import "./a-type-import-of-a-default-and-names.ts";
import "./a-decorator-ahead-of-abstract.ts";
import "./a-decorated-parameter-of-a-declared-function.ts";
console.log("ran");
/* Build errors:
error: TS100306: Expected "{" but found "("
error: TS100306: Expected identifier but found ")"
error: TS1009: Trailing comma not allowed.
error: TS100306: "#x" has already been declared
error: TS100306: Expected identifier but found "["
error: TS100306: Invalid field name
error: TS100306: Cannot use "let" as an identifier here
error: TS100306: Expected identifier but found "@"
error: TS100306: Expected ")" but found "dec"
error: TS100306: Expected ";" but found "a"
error: TS100306: Unexpected )
error: TS100306: Expected "class" but found "abstract"
error: TS100306: Unexpected {
error: TS100306: Expected ">" but found "T"
error: TS100306: Expected identifier but found ">"
error: TS100306: Expected ")" but found "("
error: TS100306: Expected ";" but found ")"
error: TS100306: Expected ")" but found "a"
error: TS100306: Unexpected =>
error: TS100306: Unexpected #a
error: TS100306: Unexpected =
error: TS100306: Unexpected if
error: TS100306: Expected ")" but found ","
error: TS100306: Expected ")" but found "b"
error: TS100306: Expected "from" but found ","
error: TS100306: Expected identifier but found "{"
error: TS100306: Expected ";" but found "x"
error: TS100306: Expected string but found "x"
error: TS100306: Expected "]" but found ","
error: TS100306: Expected ":" but found "j"
error: TS100306: Unexpected :
error: TS100306: Expected ";" but found "]"
error: TS100306: Expected identifier but found ":"
error: TS100306: Expected ":" but found ";"
error: TS100306: Unexpected }
error: TS100306: Expected ")" but found "="
error: TS100306: Expected ")" but found "1"
error: TS100306: Expected "{" but found end of file
error: TS100306: Unexpected "import"
error: TS100306: Cannot use "declare" with a "using" declaration
error: TS100306: Unexpected "async"
error: TS100306: Expected ";" but found "var"
error: TS100306: Expected ";" but found "declare"
error: TS100306: Unexpected ?
error: TS100306: Expected ";" but found "A"
error: TS100306: The modifier "in" is not valid here
*/
