import type { JSException, JSException as JSExceptionType, Message, Problems } from "../../src/api/schema";
import { normalizedFilename, StackFrameIdentifier, StackFrameScope, thisCwd } from "./index";

export function problemsToMarkdown(problems: Problems) {
  var markdown = "";
  if (problems?.build?.msgs?.length) {
    markdown += messagesToMarkdown(problems.build.msgs);
  }

  if (problems?.exceptions?.length) {
    markdown += exceptionsToMarkdown(problems.exceptions);
  }

  return markdown;
}

export function messagesToMarkdown(messages: Message[]): string {
  return messages
    .map(messageToMarkdown)
    .map(a => a.trim())
    .join("\n");
}

export function exceptionsToMarkdown(exceptions: JSExceptionType[]): string {
  return exceptions
    .map(exceptionToMarkdown)
    .map(a => a.trim())
    .join("\n");
}

function exceptionToMarkdown(exception: JSException): string {
  const { name: name_, message: message_, stack } = exception;

  var name = String(name_).trim();
  var message = String(message_).trim();

  // check both so if it turns out one of them was only whitespace, we don't count it
  const hasName = name_ && name_.length > 0 && name.length > 0;
  const hasMessage = message_ && message_.length > 0 && message.length > 0;

  let markdown = "";

  if (
    (name === "Error" ||
      name === "RangeError" ||
      name === "TypeError" ||
      name === "ReferenceError" ||
      name === "DOMException") &&
    hasMessage
  ) {
    markdown += `**${message}**\n`;
  } else if (hasName && hasMessage) {
    markdown += `**${name}**\n${message}\n`;
  } else if (hasMessage) {
    markdown += `${message}\n`;
  } else if (hasName) {
    markdown += `**${name}**\n`;
  }

  if (stack.frames.length > 0) {
    var frames = stack.frames;
    if (stack.source_lines.length > 0) {
      const {
        file: _file = "",
        function_name = "",
        position: { line = -1, column_start: column = -1, column_stop: columnEnd = column } = {
          line: -1,
          column_start: -1,
          column_stop: -1,
        },
        scope = 0 as any,
      } = stack.frames[0];
      const file = normalizedFilename(_file, thisCwd);

      if (file) {
        if (function_name.length > 0) {
          markdown += `In \`${function_name}\` – ${file}`;
        } else if (scope > 0 && scope < StackFrameScope.Constructor + 1) {
          markdown += `${StackFrameIdentifier({
            functionName: function_name,
            scope,
            markdown: true,
          })} ${file}`;
        } else {
          markdown += `In ${file}`;
        }

        if (line > -1) {
          markdown += `:${line}`;
          if (column > -1) {
            markdown += `:${column}`;
          }
        }

        if (stack.source_lines.length > 0) {
          // TODO: include loader
          const extnameI = file.lastIndexOf(".");
          const extname = extnameI > -1 ? file.slice(extnameI + 1) : "";

          markdown += "\n```";
          markdown += extname;
          markdown += "\n";
          stack.source_lines.forEach(sourceLine => {
            const lineText = sourceLine.text.trimEnd();
            markdown += lineText + "\n";
            if (sourceLine.line === line && stack.source_lines.length > 1) {
              // the comment should start at the first non-whitespace character
              // ideally it should be length the original line
              // but it may not be
              var prefix = "".padStart(lineText.length - lineText.trimStart().length, " ");

              prefix += "/* ".padEnd(column - 1 - prefix.length, " ") + "^ happened here ";
              markdown += prefix.padEnd(Math.max(lineText.length, 1) - 1, " ") + "*/\n";
            }
          });
          markdown = markdown.trimEnd() + "\n```";
        }
      }
    }

    if (frames.length > 0) {
      markdown += "\nStack trace:\n";
      var padding = 0;
      // Limit to 8 frames because it may be a huge stack trace
      // and we want to not hit the message limit
      const framesToDisplay = frames.slice(0, Math.min(frames.length, 8));
      for (let frame of framesToDisplay) {
        const {
          function_name = "",
          position: { line = -1, column_start: column = -1 } = {
            line: -1,
            column_start: -1,
          },
          scope = 0 as any,
        } = frame;
        padding = Math.max(
          padding,
          StackFrameIdentifier({
            scope,
            functionName: function_name,
            markdown: true,
          }).length,
        );
      }

      markdown += "```js\n";

      for (let frame of framesToDisplay) {
        const {
          file = "",
          function_name = "",
          position: { line = -1, column_start: column = -1 } = {
            line: -1,
            column_start: -1,
          },
          scope = 0 as any,
        } = frame;

        markdown += `
  ${StackFrameIdentifier({
    scope,
    functionName: function_name,
    markdown: true,
  }).padEnd(padding, " ")}`;

        if (file) {
          markdown += ` ${normalizedFilename(file, thisCwd)}`;
          if (line > -1) {
            markdown += `:${line}`;
            if (column > -1) {
              markdown += `:${column}`;
            }
          }
        }
      }

      markdown += "\n```\n";
    }
  }

  return markdown;
}

function messageToMarkdown(message: Message): string {
  var tag = "Error";
  if (message.on.build) {
    tag = "BuildError";
  }
  var lines = (message.data.text ?? "").split("\n");

  var markdown = "";
  if (message?.on?.resolve) {
    markdown += `**ResolveError**: "${message.on.resolve}" failed to resolve\n`;
  } else {
    var firstLine = lines[0];
    lines = lines.slice(1);
    if (firstLine.length > 120) {
      const words = firstLine.split(" ");
      var end = 0;
      for (let i = 0; i < words.length; i++) {
        if (end + words[i].length >= 120) {
          firstLine = words.slice(0, i).join(" ");
          lines.unshift(words.slice(i).join(" "));
          break;
        }
      }
    }

    markdown += `**${tag}**${firstLine.length > 0 ? ": " + firstLine : ""}\n`;
  }

  if (message.data?.location?.file) {
    markdown += `In ${normalizedFilename(message.data.location.file, thisCwd)}`;
    if (message.data.location.line > -1) {
      markdown += `:${message.data.location.line}`;
      if (message.data.location.column > -1) {
        markdown += `:${message.data.location.column}`;
      }
    }

    if (message.data.location.line_text.length) {
      const extnameI = message.data.location.file.lastIndexOf(".");
      const extname = extnameI > -1 ? message.data.location.file.slice(extnameI + 1) : "";

      markdown += "\n```" + extname + "\n" + message.data.location.line_text + "\n```\n";
    } else {
      markdown += "\n";
    }

    if (lines.length > 0) {
      markdown += lines.join("\n");
    }
  }

  return markdown;
}

export const withBunInfo = text => {
  const bunInfo = getBunInfo();

  const trimmed = text.trim();

  if (bunInfo && "then" in bunInfo) {
    return bunInfo.then(
      info => {
        const markdown = bunInfoToMarkdown(info).trim();
        return trimmed + "\n" + markdown + "\n";
      },
      () => trimmed + "\n",
    );
  }

  if (bunInfo) {
    const markdown = bunInfoToMarkdown(bunInfo).trim();

    return trimmed + "\n" + markdown + "\n";
  }

  return trimmed + "\n";
};

function bunInfoToMarkdown(_info) {
  if (!_info) return;
  const info = { ..._info, platform: { ..._info.platform } };

  var operatingSystemVersion = info.platform.version;

  if (info.platform.os.toLowerCase() === "macos") {
    const [major, minor, patch] = operatingSystemVersion.split(".");
    switch (major) {
      case "22": {
        operatingSystemVersion = `13.${minor}.${patch}`;
        break;
      }
      case "21": {
        operatingSystemVersion = `12.${minor}.${patch}`;
        break;
      }
      case "20": {
        operatingSystemVersion = `11.${minor}.${patch}`;
        break;
      }

      case "19": {
        operatingSystemVersion = `10.15.${patch}`;
        break;
      }

      case "18": {
        operatingSystemVersion = `10.14.${patch}`;
        break;
      }

      case "17": {
        operatingSystemVersion = `10.13.${patch}`;
        break;
      }

      case "16": {
        operatingSystemVersion = `10.12.${patch}`;
        break;
      }

      case "15": {
        operatingSystemVersion = `10.11.${patch}`;
        break;
      }
    }
    info.platform.os = "macOS";
  }

  if (info.platform.arch === "arm" && info.platform.os === "macOS") {
    info.platform.arch = "Apple Silicon";
  } else if (info.platform.arch === "arm") {
    info.platform.arch = "aarch64";
  }

  var base = `Info:
  > bun v${info.bun_version}
  `;

  if (info.framework && info.framework_version) {
    base += `> framework: ${info.framework}@${info.framework_version}`;
  } else if (info.framework) {
    base += `> framework: ${info.framework}`;
  }

  base =
    base.trim() +
    `
  > ${info.platform.os} ${operatingSystemVersion} (${info.platform.arch})
  > User-Agent: ${globalThis.navigator.userAgent}
  > Pathname: ${globalThis.location.pathname}
  `;

  return base;
}

var bunInfoMemoized;
function getBunInfo() {
  if (bunInfoMemoized) return bunInfoMemoized;
  if ("sessionStorage" in globalThis) {
    try {
      const bunInfoMemoizedString = sessionStorage.getItem("__bunInfo");
      if (bunInfoMemoizedString) {
        bunInfoMemoized = JSON.parse(bunInfoMemoized);
        return bunInfoMemoized;
      }
    } catch (exception) {}
  }
  const controller = new AbortController();
  const timeout = 1000;
  const id = setTimeout(() => controller.abort(), timeout);
  return fetch("/bun:info", {
    signal: controller.signal,
    headers: {
      Accept: "application/json",
    },
  })
    .then(resp => resp.json())
    .then(bunInfo => {
      clearTimeout(id);
      bunInfoMemoized = bunInfo;
      if ("sessionStorage" in globalThis) {
        try {
          sessionStorage.setItem("__bunInfo", JSON.stringify(bunInfo));
        } catch (exception) {}
      }

      return bunInfo;
    });
}
