// A method asks its parameter by `instanceof` and is called with strings, instances, heirs and other objects.
class Token {
    constructor(text, line) {
        this._text = text;
        this._line = line;
    }
    isEqualTo(other) {
        if (other instanceof Token)
            return this.text === other.text;
        return this.text === other;
    }
    compare(other, more) {
        return other instanceof Token ? this._line - other._line : more ? -1 : 1;
    }
    get text() {
        return this._text;
    }
}
class Keyword extends Token {
    get text() {
        return this._text.toUpperCase();
    }
}
const key = JSON.parse('"hidden"');
const box = JSON.parse("{}");
function hide(value) {
    box[key] = value;
    return box[key];
}
const tokens = hide(["a", "b", "if", "\n", "a"].map((text, line) => hide(text === "if" ? new Keyword(text, line) : new Token(text, line))));
class Parser {
    constructor(all) {
        this.all = all;
        this.at = 0;
    }
    count(text) {
        let found = 0;
        for (this.at = 0; this.at < this.all.length; this.at++) {
            if (this.all[this.at].isEqualTo(text))
                found++;
        }
        return found;
    }
}
const parser = new Parser(tokens);
const others = ["a", "IF", "if", "\n", null, undefined, 3, new Token("a", 9), new Keyword("if", 8), { _text: "a", text: "a" }, Object.create(Token.prototype), Object.create(new Token("b", 5)), new Proxy(new Token("a", 7), {})];
const say = word => console.log(word, others.map(other => parser.count(other)).join(), others.map(other => tokens.map(token => token.compare(other, other)).join(" ")).join());
say("as made");
Object.setPrototypeOf(tokens[0], Keyword.prototype);
say("another prototype");
Object.defineProperty(Token, Symbol.hasInstance, { value: other => typeof other === "string", configurable: true });
console.log(tokens.map(token => {
    try {
        return token.isEqualTo("a");
    } catch (error) {
        return error.message;
    }
}).join());
