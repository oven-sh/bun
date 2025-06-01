interface HighlighterOptions {
  enableColors: boolean;
  redactSensitiveInformation: boolean;
  languageName?: string;
  showLineNumbers?: boolean;
}

const enum TokenClass {
  Keyword = "syntax-pink",
  Type = "syntax-cyan italic",
  Parameter = "syntax-orange italic",
  Error = "syntax-red",
  Operator = "syntax-pink",
  Function = "syntax-green",
  String = "syntax-yellow",
  Comment = "syntax-gray",
  Constant = "syntax-purple",
  Variable = "syntax-fg",
  Generic = "syntax-orange italic",
  KeywordNew = "syntax-pink bold",
  Decorator = "syntax-green italic",
  JSXTag = "syntax-cyan",
  JSXComponent = "syntax-green",
  JSXAttribute = "syntax-orange",
  JSXString = "syntax-yellow",
  JSXText = "syntax-fg",
  JSXPunctuation = "syntax-pink",
  JSXExpression = "syntax-pink",
}

// Pre-compile keyword maps for Dracula-compliant highlighting
const keywordColorMap = new Map<string, TokenClass>([
  // Flow control keywords
  ["if", TokenClass.Keyword],
  ["else", TokenClass.Keyword],
  ["for", TokenClass.Keyword],
  ["while", TokenClass.Keyword],
  ["do", TokenClass.Keyword],
  ["switch", TokenClass.Keyword],
  ["case", TokenClass.Keyword],
  ["break", TokenClass.Keyword],
  ["continue", TokenClass.Keyword],
  ["return", TokenClass.Keyword],
  ["try", TokenClass.Keyword],
  ["catch", TokenClass.Keyword],
  ["finally", TokenClass.Keyword],
  ["throw", TokenClass.Keyword],

  // Declaration keywords
  ["const", TokenClass.Keyword],
  ["let", TokenClass.Keyword],
  ["var", TokenClass.Keyword],
  ["function", TokenClass.Keyword],
  ["class", TokenClass.Keyword],

  // TypeScript specific
  ["interface", TokenClass.Type],
  ["type", TokenClass.Type],
  ["enum", TokenClass.Type],
  ["namespace", TokenClass.Type],
  ["abstract", TokenClass.Type],
  ["implements", TokenClass.Type],
  ["readonly", TokenClass.Type],
  ["private", TokenClass.Type],
  ["protected", TokenClass.Type],
  ["public", TokenClass.Type],
  ["static", TokenClass.Type],
  ["declare", TokenClass.Type],
  ["extends", TokenClass.Type],

  // Values
  ["true", TokenClass.Constant],
  ["false", TokenClass.Constant],
  ["null", TokenClass.Constant],
  ["undefined", TokenClass.Constant],
  ["this", TokenClass.Parameter],

  // Modules
  ["import", TokenClass.Keyword],
  ["export", TokenClass.Keyword],
  ["from", TokenClass.Keyword],
  ["as", TokenClass.Type],
  ["default", TokenClass.Keyword],

  // Async
  ["async", TokenClass.Keyword],
  ["await", TokenClass.Keyword],

  // Special keywords
  ["new", TokenClass.KeywordNew],
]);

// Add TypeScript modifiers
const typeModifiers = new Set(["private", "protected", "public", "readonly", "abstract", "static", "declare"]);

// Add JSX-specific tokens
const htmlTags = new Set([
  "a",
  "abbr",
  "address",
  "area",
  "article",
  "aside",
  "audio",
  "b",
  "base",
  "bdi",
  "bdo",
  "blockquote",
  "body",
  "br",
  "button",
  "canvas",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "data",
  "datalist",
  "dd",
  "del",
  "details",
  "dfn",
  "dialog",
  "div",
  "dl",
  "dt",
  "em",
  "embed",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "header",
  "hr",
  "html",
  "i",
  "iframe",
  "img",
  "input",
  "ins",
  "kbd",
  "label",
  "legend",
  "li",
  "link",
  "main",
  "map",
  "mark",
  "meta",
  "meter",
  "nav",
  "noscript",
  "object",
  "ol",
  "optgroup",
  "option",
  "output",
  "p",
  "param",
  "picture",
  "pre",
  "progress",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "script",
  "section",
  "select",
  "small",
  "source",
  "span",
  "strong",
  "style",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "template",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "time",
  "title",
  "tr",
  "track",
  "u",
  "ul",
  "var",
  "video",
  "wbr",
]);

const sensitivePatterns = new Set(["_auth", "_authToken", "token", "_password", "email"]);

// Character sets for lexing
const IDENTIFIER_START = new Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$_");
const IDENTIFIER_PART = new Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$_");
const WHITESPACE = new Set(" \t\n\r");
const DIGITS = new Set("0123456789");
const HEX_DIGITS = new Set("0123456789abcdefABCDEF");
const OPERATORS = new Set("+-*/%=<>!&|^~?:");

enum TokenType {
  Whitespace = "Whitespace",
  Newline = "Newline",
  Identifier = "Identifier",
  Keyword = "Keyword",
  String = "String",
  Number = "Number",
  Operator = "Operator",
  Comment = "Comment",
  TemplateString = "TemplateString",
  TemplateInterpolation = "TemplateInterpolation",
  Punctuator = "Punctuator",
  JSXTag = "JSXTag",
  JSXComponent = "JSXComponent",
  JSXAttribute = "JSXAttribute",
  JSXString = "JSXString",
  JSXText = "JSXText",
  JSXPunctuation = "JSXPunctuation",
  JSXExpression = "JSXExpression",
  Type = "Type",
  TypeParameter = "TypeParameter",
  Interface = "Interface",
  Enum = "Enum",
}

interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
  tokenClass?: TokenClass;
}

export class DraculaSyntaxHighlighter {
  private text: string;
  private pos: number = 0;
  private line: number = 1;
  private column: number = 0;
  private readonly options: HighlighterOptions;

  // Add JSX state tracking
  private isInJSXTag: boolean = false;
  private isJSXTagStart: boolean = false;

  // Add TypeScript state tracking
  private isExpectingTypeName: boolean = false;
  private isInGenericType: boolean = false;
  private isInDestructuring: boolean = false;
  private isAfterExtendsOrImplements: boolean = false;

  constructor(text: string, options: Partial<HighlighterOptions> = {}) {
    this.text = text;
    this.options = {
      enableColors: true,
      redactSensitiveInformation: false,
      languageName: "javascript",
      showLineNumbers: false,
      ...options,
    };

    // Initialize state
    this.pos = 0;
    this.line = 1;
    this.column = 0;
    this.isInJSXTag = false;
    this.isJSXTagStart = false;
    this.isExpectingTypeName = false;
    this.isInGenericType = false;
    this.isInDestructuring = false;
    this.isAfterExtendsOrImplements = false;
  }

  private peek(offset: number = 0): string {
    return this.text[this.pos + offset] || "";
  }

  private consume(length: number = 1): string {
    const value = this.text.slice(this.pos, this.pos + length);
    for (const char of value) {
      if (char === "\n") {
        this.line++;
        this.column = 0;
      } else {
        this.column++;
      }
    }
    this.pos += length;
    return value;
  }

  private createToken(type: TokenType, value: string, tokenClass?: TokenClass): Token {
    return {
      type,
      value,
      line: this.line,
      column: this.column - value.length,
      tokenClass,
    };
  }

  private lexWhitespace(): Token | null {
    let value = "";
    while (this.pos < this.text.length && this.isWhitespace(this.peek()) && this.peek() !== "\n") {
      value += this.consume();
    }
    return value ? this.createToken(TokenType.Whitespace, value) : null;
  }

  private lexNewline(): Token | null {
    return this.peek() === "\n" ? this.createToken(TokenType.Newline, this.consume()) : null;
  }

  private lexIdentifierOrKeyword(): Token | null {
    if (!this.isIdentifierStart(this.peek())) return null;

    const value = this.consumeIdentifier();
    const tokenClass = keywordColorMap.get(value);

    // Handle JSX tags and components
    if (this.isInJSXTag) {
      if (this.isJSXTagStart) {
        this.isJSXTagStart = false;
        return this.createToken(
          TokenType.JSXTag,
          value,
          htmlTags.has(value.toLowerCase()) ? TokenClass.JSXTag : TokenClass.JSXComponent,
        );
      }
      return this.createToken(TokenType.JSXAttribute, value, TokenClass.JSXAttribute);
    }

    // Handle TypeScript keywords and types
    if (tokenClass) {
      // Special handling for TypeScript modifiers and type keywords
      if (typeModifiers.has(value)) {
        return this.createToken(TokenType.Keyword, value, TokenClass.Type);
      }
      if (value === "interface" || value === "type" || value === "enum") {
        this.isExpectingTypeName = true;
        return this.createToken(TokenType.Keyword, value, TokenClass.Type);
      }
      if (value === "extends" || value === "implements") {
        this.isAfterExtendsOrImplements = true;
      }
      return this.createToken(TokenType.Keyword, value, tokenClass);
    }

    // Handle type names and references
    if (this.isExpectingTypeName) {
      this.isExpectingTypeName = false;
      return this.createToken(TokenType.Identifier, value, TokenClass.Type);
    }

    // Check if this is a type reference
    const nextChar = this.peek();
    const prevChar = this.pos > 0 ? this.text[this.pos - 1] : "";
    if (
      (prevChar === ":" && !this.isInDestructuring) ||
      this.isAfterExtendsOrImplements ||
      (prevChar === "<" && this.isInGenericType) ||
      (prevChar === "<" && nextChar !== "=" && !this.isInJSXTag)
    ) {
      return this.createToken(TokenType.Identifier, value, TokenClass.Type);
    }

    if (this.peek() === "(") {
      return this.createToken(TokenType.Identifier, value, TokenClass.Function);
    }

    return this.createToken(TokenType.Identifier, value, TokenClass.Variable);
  }

  private lexNumber(): Token | null {
    if (!this.isDigit(this.peek())) return null;

    const value = this.consumeNumber();
    return this.createToken(TokenType.Number, value, TokenClass.Constant);
  }

  private lexString(): Token | null {
    const quote = this.peek();
    if (quote !== '"' && quote !== "'" && quote !== "`") return null;

    if (quote === "`") {
      return this.lexTemplateString();
    }

    const value = this.consumeString(quote);
    return this.createToken(TokenType.String, value, TokenClass.String);
  }

  private lexTemplateString(): Token | null {
    const tokens: Token[] = [];
    let str = this.consume(); // Initial backtick

    while (this.pos < this.text.length) {
      const char = this.peek();
      const prevChar = this.peek(-1);

      if (char === "`" && prevChar !== "\\") {
        str += this.consume();
        tokens.push(this.createToken(TokenType.TemplateString, str, TokenClass.String));
        break;
      }

      if (char === "$" && this.peek(1) === "{" && prevChar !== "\\") {
        if (str) {
          tokens.push(this.createToken(TokenType.TemplateString, str, TokenClass.String));
          str = "";
        }

        const interpStart = this.consume(2);
        tokens.push(this.createToken(TokenType.TemplateInterpolation, interpStart, TokenClass.Operator));

        let braceCount = 1;
        while (this.pos < this.text.length && braceCount > 0) {
          const c = this.peek();
          if (c === "{") braceCount++;
          if (c === "}") braceCount--;

          if (braceCount === 0) {
            tokens.push(this.createToken(TokenType.TemplateInterpolation, this.consume(), TokenClass.Operator));
          } else {
            const token = this.nextToken();
            if (token) tokens.push(token);
          }
        }
        continue;
      }

      if (char === "\\") {
        str += this.consume(2);
      } else {
        str += this.consume();
      }
    }

    return tokens[0]; // Return first token, others will be picked up in next iterations
  }

  private lexComment(): Token | null {
    if (this.peek() !== "/" || (this.peek(1) !== "/" && this.peek(1) !== "*")) return null;

    const value = this.consumeComment();
    return this.createToken(TokenType.Comment, value, TokenClass.Comment);
  }

  private lexOperator(): Token | null {
    if (!this.isOperator(this.peek())) return null;

    const value = this.consumeOperator();
    return this.createToken(TokenType.Operator, value, TokenClass.Operator);
  }

  private lexPunctuator(): Token | null {
    const char = this.peek();
    if ("[](){}.,;".includes(char)) {
      if (char === "<") {
        const next = this.peek(1);
        if (this.isIdentifierStart(next) || next === "/") {
          this.isInJSXTag = true;
          this.isJSXTagStart = true;
        } else if (this.isIdentifierStart(this.peek(2))) {
          this.isInGenericType = true;
        }
      } else if (char === ">") {
        this.isInJSXTag = false;
        this.isInGenericType = false;
      } else if (char === "{") {
        this.isInDestructuring = true;
      } else if (char === "}") {
        this.isInDestructuring = false;
      }
      return this.createToken(TokenType.Punctuator, this.consume(), TokenClass.Operator);
    }
    return null;
  }

  private nextToken(): Token | null {
    if (this.pos >= this.text.length) return null;

    const token =
      this.lexWhitespace() ||
      this.lexNewline() ||
      this.lexComment() ||
      this.lexString() ||
      this.lexIdentifierOrKeyword() ||
      this.lexNumber() ||
      this.lexOperator() ||
      this.lexPunctuator() ||
      this.createToken(TokenType.Operator, this.consume(), TokenClass.Operator);

    // Reset extends/implements state after non-whitespace tokens
    if (token?.type !== TokenType.Whitespace && token?.type !== TokenType.Newline) {
      this.isAfterExtendsOrImplements = false;
    }

    return token;
  }

  private *tokenize(): Generator<Token> {
    while (this.pos < this.text.length) {
      const token = this.nextToken();
      if (token) yield token;
    }
  }

  public highlight(): string {
    const containerClass = this.options.languageName
      ? `dracula-theme language-${this.options.languageName}`
      : "dracula-theme";

    const classAttr = this.options.showLineNumbers ? `${containerClass} with-line-numbers` : containerClass;

    let result = "";
    let lineContent = "";
    let currentLine = 1;

    const startNewLine = () => {
      if (lineContent) {
        result += this.buildHtmlElement("div", { "class": "line" }, lineContent);
        lineContent = "";
      }
    };

    for (const token of this.tokenize()) {
      if (token.type === TokenType.Newline) {
        startNewLine();
        currentLine++;
        continue;
      }

      if (token.tokenClass) {
        lineContent += this.wrap(token.value, token.tokenClass);
      } else {
        lineContent += this.escapeHtml(token.value);
      }
    }

    // Handle any remaining content
    startNewLine();

    // Wrap everything in pre tag
    return this.buildHtmlElement("pre", { "class": classAttr }, result);
  }

  public highlightLine() {
    let lineContent = "";

    for (const token of this.tokenize()) {
      if (token.type === TokenType.Newline) {
        continue;
      }

      if (token.tokenClass) {
        lineContent += this.wrap(token.value, token.tokenClass);
      } else {
        lineContent += this.escapeHtml(token.value);
      }
    }

    return lineContent;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private buildHtmlElement(tag: string, attributes: Record<string, string>, content: string): string {
    const attrs = Object.entries(attributes)
      .map(([key, value]) => `${key}="${this.escapeHtml(value)}"`)
      .join(" ");

    return `<${tag}${attrs ? " " + attrs : ""}>${content}</${tag}>`;
  }

  private wrap(content: string, tokenClass: string): string {
    if (!this.options.enableColors) return this.escapeHtml(content);

    // Handle multiple classes (e.g., "syntax-pink bold")
    const classes = tokenClass
      .split(" ")
      .map(cls => cls.trim())
      .join(" ");
    return `<span class="${classes}">${this.escapeHtml(content)}</span>`;
  }

  private isIdentifierStart(char: string): boolean {
    return IDENTIFIER_START.has(char);
  }

  private isIdentifierPart(char: string): boolean {
    return IDENTIFIER_PART.has(char);
  }

  private isWhitespace(char: string): boolean {
    return WHITESPACE.has(char);
  }

  private isDigit(char: string): boolean {
    return DIGITS.has(char);
  }

  private isHexDigit(char: string): boolean {
    return HEX_DIGITS.has(char);
  }

  private isOperator(char: string): boolean {
    return OPERATORS.has(char);
  }

  private consumeIdentifier(): string {
    let identifier = this.consume();
    while (this.pos < this.text.length && this.isIdentifierPart(this.peek())) {
      identifier += this.consume();
    }
    return identifier;
  }

  private consumeString(quote: string): string {
    let str = "";
    let pos = this.pos;
    let isEscaped = false;

    // Consume initial quote
    str += this.consume();

    while (this.pos < this.text.length) {
      const char = this.peek();

      if (isEscaped) {
        str += this.consume();
        isEscaped = false;
        continue;
      }

      if (char === "\\") {
        str += this.consume();
        isEscaped = true;
        continue;
      }

      if (char === quote) {
        str += this.consume();
        break;
      }

      str += this.consume();
    }

    return str;
  }

  private consumeTemplateString(): string {
    let str = "";
    let pos = this.pos;
    let isEscaped = false;

    // Consume initial backtick
    str += this.consume();

    while (this.pos < this.text.length) {
      const char = this.peek();

      if (isEscaped) {
        str += this.consume();
        isEscaped = false;
        continue;
      }

      if (char === "\\") {
        str += this.consume();
        isEscaped = true;
        continue;
      }

      if (char === "`") {
        str += this.consume();
        break;
      }

      if (char === "$" && this.peek(1) === "{") {
        return str;
      }

      str += this.consume();
    }

    return str;
  }

  private consumeNumber(): string {
    let num = "";
    // Handle hex
    if (this.peek() === "0") {
      const next = this.peek(1);
      if (next === "x" || next === "X") {
        num = this.consume(2);
        while (this.pos < this.text.length && this.isHexDigit(this.peek())) {
          num += this.consume();
        }
        return num;
      }
    }

    // Regular number
    while (this.pos < this.text.length) {
      const char = this.peek();
      if (this.isDigit(char) || char === "." || char === "e" || char === "E") {
        num += this.consume();
      } else {
        break;
      }
    }
    return num;
  }

  private consumeComment(): string {
    const commentStart = this.consume(2); // Consume // or /*
    let comment = commentStart;
    const isLineComment = commentStart === "//";

    if (isLineComment) {
      // Consume until newline or end of file
      while (this.pos < this.text.length) {
        const char = this.peek();
        if (char === "\n") {
          // Don't consume the newline as part of the comment
          break;
        }
        comment += this.consume();
      }
    } else {
      // Handle block comments
      let foundEnd = false;
      while (this.pos < this.text.length && !foundEnd) {
        if (this.peek() === "*" && this.peek(1) === "/") {
          comment += this.consume(2);
          foundEnd = true;
        } else {
          comment += this.consume();
        }
      }
    }
    return comment;
  }

  private consumeOperator(): string {
    let operator = this.consume();

    // Handle multi-character operators
    const next = this.peek();
    if (this.isOperator(next)) {
      const combined = operator + next;
      // Handle common compound operators
      if (["==", "===", "!=", "!==", ">=", "<=", "++", "--", "&&", "||", "??", ">>", "<<", "=>"].includes(combined)) {
        operator += this.consume();
        // Handle triple operators
        if (
          (combined === "==" || combined === "!=" || combined === "<<" || combined === ">>") &&
          this.peek() === combined[0]
        ) {
          operator += this.consume();
        }
      }
    }
    return operator;
  }

  private shouldRedactSensitive(str: string): boolean {
    // Simple string matching without regex
    // Check for UUID-like pattern
    if (str.length === 36 && str[8] === "-" && str[13] === "-" && str[18] === "-" && str[23] === "-") {
      const isValidChar = (c: string) => this.isHexDigit(c) || c === "-";
      return [...str].every(isValidChar);
    }

    // Check for URL with credentials
    if (str.includes("@") && (str.startsWith("http://") || str.startsWith("https://") || str.startsWith("ftp://"))) {
      return true;
    }

    // Check for NPM token
    if (str.startsWith("npm_") && str.length === 68) {
      const isValidTokenChar = (c: string) => this.isIdentifierPart(c);
      return str.slice(4).every(isValidTokenChar);
    }

    return false;
  }
}

export function syntaxHighlight(code: string) {
  return new DraculaSyntaxHighlighter(code).highlightLine();
}
