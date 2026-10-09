// Ported from Node.js v26.3.0 lib/internal/readline/utils.js for Bun's node:repl.
// Attribution: derived from Node.js, MIT licensed (Node.js contributors).
// prettier-ignore
const primordials = require("internal/repl/node-primordials");
var __node_module__ = { exports: {} };

const {
  ArrayPrototypeToSorted,
  StringFromCharCode,
  StringPrototypeCodePointAt,
  StringPrototypeSlice,
  StringPrototypeSplit,
  Symbol,
} = primordials;

const StringPrototypeCharCodeAtFn = String.prototype.charCodeAt;
const StringPrototypeSliceFn = String.prototype.slice;
const StringPrototypeToLowerCaseFn = String.prototype.toLowerCase;

const kUTF16SurrogateThreshold = 0x10000; // 2 ** 16
const kEscape = "\x1b";
const kSubstringSearch = Symbol("kSubstringSearch");

function CSI(strings, ...args) {
  let ret = `${kEscape}[`;
  for (let n = 0; n < strings.length; n++) {
    ret += strings[n];
    if (n < args.length) ret += args[n];
  }
  return ret;
}

CSI.kEscape = kEscape;
CSI.kClearToLineBeginning = CSI`1K`;
CSI.kClearToLineEnd = CSI`0K`;
CSI.kClearLine = CSI`2K`;
CSI.kClearScreenDown = CSI`0J`;

// upstream-todo(BridgeAR): Treat combined characters as single character, i.e,
// 'a\u0301' and '\u0301a' (both have the same visual output).
// Check Canonical_Combining_Class in
// http://userguide.icu-project.org/strings/properties
function charLengthLeft(str, i) {
  if (i <= 0) return 0;
  if (
    (i > 1 && StringPrototypeCodePointAt(str, i - 2) >= kUTF16SurrogateThreshold) ||
    StringPrototypeCodePointAt(str, i - 1) >= kUTF16SurrogateThreshold
  ) {
    return 2;
  }
  return 1;
}

function charLengthAt(str, i) {
  if (str.length <= i) {
    // Pretend to move to the right. This is necessary to autocomplete while
    // moving to the right.
    return 1;
  }
  return StringPrototypeCodePointAt(str, i) >= kUTF16SurrogateThreshold ? 2 : 1;
}

/*
  Some patterns seen in terminal key escape codes, derived from combos seen
  at http://www.midnight-commander.org/browser/lib/tty/key.c

  ESC letter
  ESC [ letter
  ESC [ modifier letter
  ESC [ 1 ; modifier letter
  ESC [ num char
  ESC [ num ; modifier char
  ESC O letter
  ESC O modifier letter
  ESC O 1 ; modifier letter
  ESC N letter
  ESC [ [ num ; modifier char
  ESC [ [ 1 ; modifier letter
  ESC ESC [ num char
  ESC ESC O letter

  - char is usually ~ but $ and ^ also happen with rxvt
  - modifier is 1 +
                (shift     * 1) +
                (left_alt  * 2) +
                (ctrl      * 4) +
                (right_alt * 8)
  - two leading ESCs apparently mean the same as one leading ESC
*/
const kIdle = 0;
const kEscaped = 1;
const kEscapedTwice = 2;
const kSS3 = 3;
const kSS3Modifier = 4;
const kCSI = 5;
const kCSIBracket = 6;
const kFirstDigit = 7;
const kSecondDigit = 8;
const kThirdDigit = 9;
const kSemicolon = 10;
const kModifier = 11;
const kRunning = 12;

// The decoder of one stream: a function that takes one character (a code point as a string, or "" when the time
// for an escape sequence is up) and `unit`, its code unit if it is a single one, else -1.
function emitKeys(stream) {
  let state = kIdle;
  let s = "";
  let code = "";
  let modifier = 0;
  let cmdStart = 0;

  function emitKeypress(sequence, key) {
    state = kRunning;
    stream.emit("keypress", sequence, key);
    state = kIdle;
  }

  function emitCharacter(ch, unit, escaped) {
    const key = {
      sequence: null,
      name: undefined,
      ctrl: false,
      meta: false,
      shift: false,
    };

    if (unit === 13) {
      // carriage return
      key.name = "return";
      key.meta = escaped;
    } else if (unit === 10) {
      // Enter, should have been called linefeed
      key.name = "enter";
      key.meta = escaped;
    } else if (unit === 9) {
      // tab
      key.name = "tab";
      key.meta = escaped;
    } else if (unit === 8 || unit === 127) {
      // backspace or ctrl+h
      key.name = "backspace";
      key.meta = escaped;
    } else if (unit === 27) {
      // escape key
      key.name = "escape";
      key.meta = escaped;
    } else if (unit === 32) {
      key.name = "space";
      key.meta = escaped;
    } else if (!escaped && unit <= 0x1a && (unit >= 0 || ch.length === 0)) {
      // ctrl+letter
      key.name = StringFromCharCode(unit + 96);
      key.ctrl = true;
    } else if (unit >= 97 ? unit <= 122 : unit >= 65 ? unit <= 90 : unit >= 48 && unit <= 57) {
      // Letter, number, shift+letter
      key.shift = unit >= 65 && unit <= 90;
      key.name = key.shift ? StringPrototypeToLowerCaseFn.$call(ch) : ch;
      key.meta = escaped;
    } else if (escaped) {
      // Escape sequence timeout
      key.name = ch.length ? undefined : "escape";
      key.meta = true;
    }

    key.sequence = s;

    if (s.length !== 0 && (key.name !== undefined || escaped)) {
      /* Named character or sequence */
      emitKeypress(escaped ? undefined : s, key);
    } else if (charLengthAt(s, 0) === s.length) {
      /* Single unnamed character, e.g. "." */
      emitKeypress(s, key);
    } else {
      /* Unrecognized or broken escape sequence, don't emit anything */
      state = kIdle;
    }
  }

  function emitSequence() {
    const key = {
      sequence: null,
      name: undefined,
      ctrl: false,
      meta: false,
      shift: false,
    };

    // Parse the key modifier
    key.ctrl = !!(modifier & 4);
    key.meta = !!(modifier & 10);
    key.shift = !!(modifier & 1);
    key.code = code;

    // Parse the key itself
    switch (code) {
      /* xterm/gnome ESC [ letter (with modifier) */
      case "[P":
        key.name = "f1";
        break;
      case "[Q":
        key.name = "f2";
        break;
      case "[R":
        key.name = "f3";
        break;
      case "[S":
        key.name = "f4";
        break;

      /* xterm/gnome ESC O letter (without modifier) */
      case "OP":
        key.name = "f1";
        break;
      case "OQ":
        key.name = "f2";
        break;
      case "OR":
        key.name = "f3";
        break;
      case "OS":
        key.name = "f4";
        break;

      /* xterm/rxvt ESC [ number ~ */
      case "[11~":
        key.name = "f1";
        break;
      case "[12~":
        key.name = "f2";
        break;
      case "[13~":
        key.name = "f3";
        break;
      case "[14~":
        key.name = "f4";
        break;

      /* paste bracket mode */
      case "[200~":
        key.name = "paste-start";
        break;
      case "[201~":
        key.name = "paste-end";
        break;

      /* from Cygwin and used in libuv */
      case "[[A":
        key.name = "f1";
        break;
      case "[[B":
        key.name = "f2";
        break;
      case "[[C":
        key.name = "f3";
        break;
      case "[[D":
        key.name = "f4";
        break;
      case "[[E":
        key.name = "f5";
        break;

      /* common */
      case "[15~":
        key.name = "f5";
        break;
      case "[17~":
        key.name = "f6";
        break;
      case "[18~":
        key.name = "f7";
        break;
      case "[19~":
        key.name = "f8";
        break;
      case "[20~":
        key.name = "f9";
        break;
      case "[21~":
        key.name = "f10";
        break;
      case "[23~":
        key.name = "f11";
        break;
      case "[24~":
        key.name = "f12";
        break;

      /* xterm ESC [ letter */
      case "[A":
        key.name = "up";
        break;
      case "[B":
        key.name = "down";
        break;
      case "[C":
        key.name = "right";
        break;
      case "[D":
        key.name = "left";
        break;
      case "[E":
        key.name = "clear";
        break;
      case "[F":
        key.name = "end";
        break;
      case "[H":
        key.name = "home";
        break;

      /* xterm/gnome ESC O letter */
      case "OA":
        key.name = "up";
        break;
      case "OB":
        key.name = "down";
        break;
      case "OC":
        key.name = "right";
        break;
      case "OD":
        key.name = "left";
        break;
      case "OE":
        key.name = "clear";
        break;
      case "OF":
        key.name = "end";
        break;
      case "OH":
        key.name = "home";
        break;

      /* xterm/rxvt ESC [ number ~ */
      case "[1~":
        key.name = "home";
        break;
      case "[2~":
        key.name = "insert";
        break;
      case "[3~":
        key.name = "delete";
        break;
      case "[4~":
        key.name = "end";
        break;
      case "[5~":
        key.name = "pageup";
        break;
      case "[6~":
        key.name = "pagedown";
        break;

      /* putty */
      case "[[5~":
        key.name = "pageup";
        break;
      case "[[6~":
        key.name = "pagedown";
        break;

      /* rxvt */
      case "[7~":
        key.name = "home";
        break;
      case "[8~":
        key.name = "end";
        break;

      /* rxvt keys with modifiers */
      case "[a":
        key.name = "up";
        key.shift = true;
        break;
      case "[b":
        key.name = "down";
        key.shift = true;
        break;
      case "[c":
        key.name = "right";
        key.shift = true;
        break;
      case "[d":
        key.name = "left";
        key.shift = true;
        break;
      case "[e":
        key.name = "clear";
        key.shift = true;
        break;

      case "[2$":
        key.name = "insert";
        key.shift = true;
        break;
      case "[3$":
        key.name = "delete";
        key.shift = true;
        break;
      case "[5$":
        key.name = "pageup";
        key.shift = true;
        break;
      case "[6$":
        key.name = "pagedown";
        key.shift = true;
        break;
      case "[7$":
        key.name = "home";
        key.shift = true;
        break;
      case "[8$":
        key.name = "end";
        key.shift = true;
        break;

      case "Oa":
        key.name = "up";
        key.ctrl = true;
        break;
      case "Ob":
        key.name = "down";
        key.ctrl = true;
        break;
      case "Oc":
        key.name = "right";
        key.ctrl = true;
        break;
      case "Od":
        key.name = "left";
        key.ctrl = true;
        break;
      case "Oe":
        key.name = "clear";
        key.ctrl = true;
        break;

      case "[2^":
        key.name = "insert";
        key.ctrl = true;
        break;
      case "[3^":
        key.name = "delete";
        key.ctrl = true;
        break;
      case "[5^":
        key.name = "pageup";
        key.ctrl = true;
        break;
      case "[6^":
        key.name = "pagedown";
        key.ctrl = true;
        break;
      case "[7^":
        key.name = "home";
        key.ctrl = true;
        break;
      case "[8^":
        key.name = "end";
        key.ctrl = true;
        break;

      /* misc. */
      case "[Z":
        key.name = "tab";
        key.shift = true;
        break;
      default:
        key.name = "undefined";
        break;
    }

    key.sequence = s;
    emitKeypress(undefined, key);
  }

  /*
   * We buffered enough data, now trying to extract code
   * and modifier from it:
   * /^(?:(\d\d?)(?:;(\d))?([~^$])|(\d{3}~))$/, then /^((\d;)?(\d))?([A-Za-z])$/
   */
  function emitCommand() {
    const cmd = StringPrototypeSliceFn.$call(s, cmdStart);
    const length = cmd.length;
    const last = StringPrototypeCharCodeAtFn.$call(cmd, length - 1);
    const digits =
      !isDigit(StringPrototypeCharCodeAtFn.$call(cmd, 0)) ? 0
      : !isDigit(StringPrototypeCharCodeAtFn.$call(cmd, 1)) ? 1
      : !isDigit(StringPrototypeCharCodeAtFn.$call(cmd, 2)) ? 2
      : 3; // prettier-ignore
    // "<digits>;<digit><last>"
    const hasModifier =
      length === digits + 3 &&
      StringPrototypeCharCodeAtFn.$call(cmd, digits) === 59 &&
      isDigit(StringPrototypeCharCodeAtFn.$call(cmd, digits + 1));

    if (last === 126 /* ~ */ || last === 94 /* ^ */ || last === 36 /* $ */) {
      if ((digits === 1 || digits === 2) && (length === digits + 1 || hasModifier)) {
        code += StringPrototypeSliceFn.$call(cmd, 0, digits) + StringPrototypeSliceFn.$call(cmd, length - 1);
        modifier = hasModifier ? StringPrototypeCharCodeAtFn.$call(cmd, digits + 1) - 49 : 0;
      } else if (digits === 3 && length === 4 && last === 126) {
        code += cmd;
      } else {
        code += cmd;
      }
    } else if (last >= 97 ? last <= 122 : last >= 65 && last <= 90) {
      if (length === 1) {
        code += cmd;
        modifier = 0;
      } else if (digits === 1 && length === 2) {
        code += StringPrototypeSliceFn.$call(cmd, 1);
        modifier = StringPrototypeCharCodeAtFn.$call(cmd, 0) - 49;
      } else if (digits === 1 && hasModifier) {
        code += StringPrototypeSliceFn.$call(cmd, 3);
        modifier = StringPrototypeCharCodeAtFn.$call(cmd, 2) - 49;
      } else {
        code += cmd;
      }
    } else {
      code += cmd;
    }
    emitSequence();
  }

  function afterEscape(ch, unit) {
    if (unit === 79 /* O */) {
      code = ch;
      modifier = 0;
      state = kSS3;
    } else if (unit === 91 /* [ */) {
      code = ch;
      modifier = 0;
      state = kCSI;
    } else {
      emitCharacter(ch, unit, true);
    }
  }

  function afterDigits(unit) {
    if (unit === 59 /* ; */) state = kSemicolon;
    else emitCommand();
  }

  function startCommand(unit) {
    cmdStart = s.length - 1;
    if (isDigit(unit)) state = kFirstDigit;
    else afterDigits(unit);
  }

  return function next(ch, unit) {
    if (state === kIdle) {
      s = ch;
      if (unit === 27) state = kEscaped;
      else emitCharacter(ch, unit, false);
      return;
    }
    if (state === kRunning) {
      // As the generator that this was.
      throw new TypeError("Generator is executing");
    }
    s += ch;
    switch (state) {
      case kEscaped:
        if (unit === 27) state = kEscapedTwice;
        else afterEscape(ch, unit);
        break;
      case kEscapedTwice:
        afterEscape(ch, unit);
        break;
      case kSS3:
        if (isDigit(unit)) {
          modifier = unit - 49;
          state = kSS3Modifier;
        } else {
          code += ch;
          emitSequence();
        }
        break;
      case kSS3Modifier:
        code += ch;
        emitSequence();
        break;
      case kCSI:
        if (unit === 91 /* [ */) {
          code += ch;
          state = kCSIBracket;
        } else {
          startCommand(unit);
        }
        break;
      case kCSIBracket:
        startCommand(unit);
        break;
      case kFirstDigit:
        if (isDigit(unit)) state = kSecondDigit;
        else afterDigits(unit);
        break;
      case kSecondDigit:
        if (isDigit(unit)) state = kThirdDigit;
        else afterDigits(unit);
        break;
      case kThirdDigit:
        afterDigits(unit);
        break;
      case kSemicolon:
        if (isDigit(unit)) state = kModifier;
        else emitCommand();
        break;
      case kModifier:
        emitCommand();
        break;
    }
  };
}

function isDigit(unit) {
  return unit >= 48 && unit <= 57;
}

// This runs in O(n log n).
function commonPrefix(strings) {
  if (strings.length === 0) {
    return "";
  }
  if (strings.length === 1) {
    return strings[0];
  }
  const sorted = ArrayPrototypeToSorted(strings);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  for (let i = 0; i < min.length; i++) {
    if (min[i] !== max[i]) {
      return StringPrototypeSlice(min, 0, i);
    }
  }
  return min;
}

function reverseString(line, from = "\r", to = "\r") {
  const parts = StringPrototypeSplit(line, from);

  // This implementation should be faster than
  // ArrayPrototypeJoin(ArrayPrototypeReverse(StringPrototypeSplit(line, from)), to);
  let result = "";
  for (let i = parts.length - 1; i > 0; i--) {
    result += parts[i] + to;
  }
  result += parts[0];

  return result;
}

__node_module__.exports = {
  charLengthAt,
  charLengthLeft,
  commonPrefix,
  emitKeys,
  reverseString,
  kSubstringSearch,
  CSI,
};

export default __node_module__.exports;
