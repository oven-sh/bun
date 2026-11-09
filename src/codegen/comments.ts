interface Comment {
  start: number;
  end: number;
  text: string;
}

const stopOutside = /[/"'`]/g;
const stopInTemplate = /[/"'`{}]/g;
const strings: Record<string, RegExp> = { '"': /"(?:[^"\\\n]|\\[^])*"/y, "'": /'(?:[^'\\\n]|\\[^])*'/y };
const templatePart = /(?:[^`\\$]|\\[^]|\$(?!\{))*(?:`|\$\{)/y;
const commentAt = /\/\/[^\r\n\u2028\u2029]*|\/\*[^]*?\*\//y;
const regexpAt = /\/(?:[^\\[/\n]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\//y;
const keywordBeforeExpression = /(?<![.\w$])(?:case|delete|do|else|in|instanceof|new|return|throw|typeof|void)$/;
/** "(a) / b / c" and "if (a) / b /.test(c)", "of / a / b" and "for (a of / b /.exec(c))" */
const isAmbiguousBehind = /[)}>]$|[\w$)\]]!$|\+\+$|--$|(?<![.\w$])(?:await|of|yield)$/;

const transpilers = {
  js: new Bun.Transpiler({ loader: "js", minifyWhitespace: true, deadCodeElimination: false }),
  ts: new Bun.Transpiler({ loader: "ts", minifyWhitespace: true, deadCodeElimination: false }),
};

const isJavaScript = (file: string) => !file.endsWith(".ts");

/** The comments of a JavaScript or TypeScript file. */
export function findComments(file: string, text: string): Comment[] {
  const comments: Comment[] = [];
  /** For each template literal that is open: how many braces are open in its substitution. */
  const braces: number[] = [];
  let at = 0;
  let codeEnd = 0;
  let commentEnd = 0;
  let hasGuessed = false;

  const behind = (pattern: RegExp) => {
    pattern.lastIndex = at;
    return pattern.test(text) ? pattern.lastIndex : undefined;
  };
  const expectBehind = (pattern: RegExp) => {
    const end = behind(pattern);
    if (end === undefined) throw new Error(`${file}: ${JSON.stringify(text.slice(at, at + 20))} has no end`);
    return end;
  };
  const behindSlash = () => {
    const regexpEnd = behind(regexpAt);
    if (regexpEnd === undefined) return at + 1;
    const beforeSlash = text.slice(commentEnd, at).trimEnd() || text.slice(0, codeEnd).trimEnd();
    const before = beforeSlash.slice(-16);
    if (isAmbiguousBehind.test(before)) hasGuessed = true;
    else if (!/[\w$\]"'`]$/.test(before) || keywordBeforeExpression.test(before)) return regexpEnd;
    return at + 1;
  };
  const template = () => {
    at = expectBehind(templatePart);
    if (text[at - 1] === "{") braces.push(1);
  };

  for (;;) {
    const stop = braces.length > 0 ? stopInTemplate : stopOutside;
    stop.lastIndex = at;
    if (!stop.test(text)) break;
    at = stop.lastIndex - 1;
    switch (text[at]) {
      case "`":
        at++;
        template();
        break;
      case "{":
        at++;
        braces[braces.length - 1]++;
        break;
      case "}":
        at++;
        if (--braces[braces.length - 1] === 0) {
          braces.pop();
          template();
        }
        break;
      case "/": {
        const end = behind(commentAt);
        if (end === undefined) {
          at = behindSlash();
          break;
        }
        if (text.slice(commentEnd, at).trim() !== "") codeEnd = at;
        comments.push({ start: at, end, text: text.slice(at, end) });
        at = commentEnd = end;
        break;
      }
      default:
        at = expectBehind(strings[text[at]]);
    }
  }

  if (hasGuessed) {
    const transpiler = transpilers[isJavaScript(file) ? "js" : "ts"];
    const meaning = (text: string) => transpiler.transformSync(text.replaceAll("@", "$"));
    const whole = meaning(text);
    let rest = "";
    let copied = 0;
    for (const { start, end, text: comment } of comments) {
      if (comment[2] === "!") continue;
      rest += text.slice(copied, start) + (comment.includes("\n") ? "\n" : " ");
      copied = end;
    }
    rest += text.slice(copied);
    if (whole === "" || meaning(rest) !== whole) {
      throw new Error(`${file}: whether a "/" begins a regular expression is not clear, put it in parentheses`);
    }
  }
  return comments;
}

const isNotice = (comment: string) =>
  /copyright|licen[cs]e|SPDX|attribution|permission is hereby granted/i.test(comment);

/** Whether a comment is one that the compiler reads, or that bundlers keep. */
function staysReadable(comment: string, file: string): boolean {
  return (
    /^\/\/\/|^\/[/*]!|@deprecated\b|@ts-|@bun\b|[@#]__[A-Z_]+__/i.test(comment) ||
    // The types of a JavaScript file.
    (isJavaScript(file) && comment.startsWith("/**"))
  );
}

const spaces = Buffer.alloc(4096, " ").toString();
const spacesFor = (text: string) =>
  text.replace(/[^\r\n\u2028\u2029]+/g, run => spaces.slice(0, Buffer.byteLength(run)));

/** A notice can be many line comments. */
function inNotices(text: string, comments: Comment[]): Set<Comment> {
  const found = new Set<Comment>();
  let notice: Comment[] = [];
  for (const comment of comments) {
    const last = notice.at(-1);
    const continues =
      last?.text[1] === "/" && comment.text[1] === "/" && /^\r?\n[ \t]*$/.test(text.slice(last.end, comment.start));
    notice = continues ? [...notice, comment] : [comment];
    if (isNotice(comment.text)) notice.forEach(it => found.add(it));
    else if (continues && found.has(last)) found.add(comment);
  }
  return found;
}

/**
 * Puts spaces in the place of what the comments of `text` say. What a comment begins and ends with stays, and so do line
 * breaks and the names of JSDoc's tags: whatever else a file has keeps its offset in UTF-8.
 */
export function blankComments(file: string, text: string): string {
  const comments = findComments(file, text);
  const notices = inNotices(text, comments);
  let out = "";
  let copied = 0;
  const keepUntil = (end: number) => {
    out += text.slice(copied, end);
    copied = end;
  };
  const blankUntil = (end: number) => {
    out += spacesFor(text.slice(copied, end));
    copied = end;
  };
  for (const comment of comments) {
    if (notices.has(comment) || staysReadable(comment.text, file)) continue;
    const isBlock = comment.text[1] === "*";
    const isDoc = /^\/\*\*[^/]/.test(comment.text);
    keepUntil(comment.start + (isDoc ? 3 : 2));
    if (isDoc) {
      for (const tag of comment.text.matchAll(/(?<=^(?:\/\*\*|[ \t]*\*?)[ \t]*)@[A-Za-z]+/gm)) {
        blankUntil(comment.start + tag.index);
        keepUntil(comment.start + tag.index + tag[0].length);
      }
    }
    blankUntil(isBlock ? comment.end - 2 : comment.end);
  }
  out += text.slice(copied);
  if (Buffer.byteLength(out) !== Buffer.byteLength(text)) throw new Error(`${file}: a comment has changed its length`);
  return out;
}
