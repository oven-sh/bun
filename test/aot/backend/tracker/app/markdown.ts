// A small subset of Markdown: headings, paragraphs, lists, quotations, fenced code, and in a line: `code`, **strong**, *emphasis*,
// [links](https://..), @mentions and #123 references to issues of the same project.

const escape = Bun.escapeHTML;

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isLoginCharacter(code: number): boolean {
  return (code >= 97 && code <= 122) || isDigit(code) || code === 45;
}

function isWordCharacter(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || isDigit(code) || code === 95;
}

function endOfRun(text: string, from: number, belongs: (code: number) => boolean): number {
  let end = from;
  while (end < text.length && belongs(text.charCodeAt(end))) end++;
  return end;
}

function renderInline(text: string, projectSlug: string): string {
  let html = "";
  let plainFrom = 0;
  let at = 0;

  // Replaces text[at, end) with markup. What lies between the last markup and this one is plain text.
  const emit = (markup: string, end: number) => {
    html += escape(text.slice(plainFrom, at)) + markup;
    at = plainFrom = end;
  };

  while (at < text.length) {
    const character = text[at];
    if (character === "`") {
      const close = text.indexOf("`", at + 1);
      if (close > at + 1) {
        emit(`<code>${escape(text.slice(at + 1, close))}</code>`, close + 1);
        continue;
      }
    } else if (character === "*") {
      if (text[at + 1] === "*") {
        const close = text.indexOf("**", at + 2);
        if (close > at + 2) {
          emit(`<strong>${escape(text.slice(at + 2, close))}</strong>`, close + 2);
          continue;
        }
      } else {
        const close = text.indexOf("*", at + 1);
        if (close > at + 1) {
          emit(`<em>${escape(text.slice(at + 1, close))}</em>`, close + 1);
          continue;
        }
      }
    } else if (character === "[") {
      const middle = text.indexOf("](", at + 1);
      const close = middle < 0 ? -1 : text.indexOf(")", middle + 2);
      if (middle > at + 1 && close > middle + 2) {
        const url = text.slice(middle + 2, close);
        if (url.startsWith("https://") || url.startsWith("http://")) {
          emit(`<a href="${escape(url)}" rel="nofollow">${escape(text.slice(at + 1, middle))}</a>`, close + 1);
          continue;
        }
      }
    } else if (character === "@" || character === "#") {
      if (at === 0 || !isWordCharacter(text.charCodeAt(at - 1))) {
        const end = endOfRun(text, at + 1, character === "@" ? isLoginCharacter : isDigit);
        if (end > at + 1) {
          const name = text.slice(at + 1, end);
          emit(
            character === "@"
              ? `<a class="mention" href="/u/${name}">@${name}</a>`
              : `<a class="reference" href="/p/${projectSlug}/issues/${name}">#${name}</a>`,
            end,
          );
          continue;
        }
      }
    }
    at++;
  }
  return html + escape(text.slice(plainFrom));
}

function isOrderedItem(line: string): boolean {
  const end = endOfRun(line, 0, isDigit);
  return end > 0 && line.startsWith(". ", end);
}

export function renderMarkdown(source: string, projectSlug: string): string {
  const lines = source.split("\n");
  let html = "";
  let at = 0;

  // Takes the lines from here on that belong to one block, without the first `skip(line)` characters of each.
  const take = (belongs: (line: string) => boolean, skip: (line: string) => number): string[] => {
    const taken: string[] = [];
    for (let line = lines[at]; line !== undefined && belongs(line); line = lines[++at]) taken.push(line.slice(skip(line)));
    return taken;
  };
  const items = (taken: string[]) => taken.map(item => `<li>${renderInline(item, projectSlug)}</li>`).join("");

  while (at < lines.length) {
    const line = lines[at]!;
    if (line === "") {
      at++;
    } else if (line.startsWith("```")) {
      at++;
      const code = take(
        line => !line.startsWith("```"),
        () => 0,
      );
      at++;
      html += `<pre><code>${escape(code.join("\n"))}</code></pre>\n`;
    } else if (line.startsWith("# ") || line.startsWith("## ") || line.startsWith("### ")) {
      const level = line.indexOf(" ");
      html += `<h${level + 2}>${renderInline(line.slice(level + 1), projectSlug)}</h${level + 2}>\n`;
      at++;
    } else if (line.startsWith("> ")) {
      const quoted = take(
        line => line.startsWith("> "),
        () => 2,
      );
      html += `<blockquote><p>${renderInline(quoted.join("\n"), projectSlug)}</p></blockquote>\n`;
    } else if (line.startsWith("- ")) {
      html += `<ul>${items(
        take(
          line => line.startsWith("- "),
          () => 2,
        ),
      )}</ul>\n`;
    } else if (isOrderedItem(line)) {
      html += `<ol>${items(take(isOrderedItem, line => line.indexOf(" ") + 1))}</ol>\n`;
    } else {
      const paragraph = take(
        line =>
          line !== "" &&
          !line.startsWith("```") &&
          !line.startsWith("# ") &&
          !line.startsWith("## ") &&
          !line.startsWith("### ") &&
          !line.startsWith("> ") &&
          !line.startsWith("- ") &&
          !isOrderedItem(line),
        () => 0,
      );
      html += `<p>${renderInline(paragraph.join("\n"), projectSlug)}</p>\n`;
    }
  }
  return html;
}
