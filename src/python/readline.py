"""Importing this module enables command line editing: the interface of GNU readline, on the line editor of the interactive interpreter."""

# The history and the settings live here and need no terminal, nor _pyrepl, which is imported when the first line is read from one.
# input() calls _read_line() once this module has been imported, if sys.stdin and sys.stdout are the terminal. The interactive
# interpreter has a history and a completer of its own, as it has beside GNU readline.

import os as _os
import sys as _sys

backend = "readline"
# The GNU readline whose interface this is.
_READLINE_VERSION = _READLINE_RUNTIME_VERSION = 0x0802
_READLINE_LIBRARY_VERSION = "8.2"

_history = []
_history_length = -1
_history_size = -1  # `set history-size`: no more items than that are kept.
_auto_history = True
_completer = None
_completer_delims = " \t\n`~!@#$%^&*()-=+[{]}\\|;:'\",<>/?"
_completion_type = 0
_startup_hook = None
_pre_input_hook = None
_display_matches_hook = None
_bindings = {}  # keys: command, as _pyrepl spells them
_variables = {  # `set name value`: those that have an effect here, besides history-size
    "bell-style": "audible",
    "completion-display-width": -1,
    "completion-query-items": 100,
    "print-completions-horizontally": False,
    "show-all-if-ambiguous": False,
    "show-all-if-unmodified": False,
}
_reader = None
_reading = False


def _text(string):
    if not isinstance(string, str):
        raise TypeError("bad argument type for built-in operation")
    if "\0" in string:
        raise ValueError("embedded null character")
    try:
        string.encode("utf-8", "surrogateescape")
    except UnicodeEncodeError as e:
        raise UnicodeEncodeError("locale", string, e.start, e.start + 1, "encoding error") from None
    return string


def _int(value):
    try:
        value = type(value).__index__(value)
    except AttributeError:
        raise TypeError(f"'{type(value).__name__}' object cannot be interpreted as an integer") from None
    if not -0x80000000 <= value <= 0x7FFFFFFF:
        raise OverflowError("Python int too large to convert to C int")
    return value


def _callable_or_none(name, function):
    if function is not None and not callable(function):
        raise TypeError(f"{name}(func): argument not callable")
    return function


# ---- The history ----


def _forget_the_oldest():
    if 0 <= _history_size < len(_history):
        del _history[: len(_history) - _history_size]


def add_history(string, /):
    """The line becomes the newest item of the history."""
    _history.append(_text(string))
    _forget_the_oldest()


def clear_history():
    """Forget the whole history."""
    del _history[:]


def get_current_history_length():
    """How many items the history has now."""
    return len(_history)


def get_history_item(index, /):
    """The item of that number, the oldest being 1. None if there is none."""
    index = _int(index)
    return _history[index - 1] if 1 <= index <= len(_history) else None


def _position(pos):
    pos = _int(pos)
    if pos < 0:
        raise ValueError("History index cannot be negative")
    if pos >= len(_history):
        raise ValueError(f"No history item at position {pos}")
    return pos


def remove_history_item(pos, /):
    """Take the item at that position out of the history. The oldest is at 0."""
    del _history[_position(pos)]


def replace_history_item(pos, line, /):
    """Put the line in the place of the item at that position. The oldest is at 0."""
    _int(pos)
    if not isinstance(line, str):
        raise TypeError(f"replace_history_item() argument 2 must be str, not {type(line).__name__}")
    _history[_position(pos)] = _text(line)


def get_history_length():
    """How many lines a history file is cut to. Negative: it is not cut."""
    return _history_length


def set_history_length(length, /):
    """History files are cut to that many lines when they are written. Negative: they are not cut."""
    global _history_length
    _history_length = _int(length)


def set_auto_history(enabled, /):
    """Whether each line that input() reads goes into the history."""
    global _auto_history
    _auto_history = bool(enabled)


def _history_file(filename):
    return _os.path.join(_os.path.expanduser("~"), ".history") if filename is None else _os.fspath(filename)


class _without_filename:
    """The errors of GNU's functions come as a number."""

    def __enter__(self):
        pass

    def __exit__(self, kind, error, traceback):
        if isinstance(error, OSError):
            raise OSError(error.errno, error.strerror) from None


def _lines(items):
    return "".join(item + "\n" for item in items).encode("utf-8", "surrogateescape")


def _cut_to_history_length(path):
    if _history_length < 0:
        return
    with open(path, "rb") as f:
        lines = f.read().splitlines(True)
    if len(lines) > _history_length:
        with open(path, "wb") as f:
            f.writelines(lines[len(lines) - _history_length :])


def read_history_file(filename=None, /):
    """Add the lines of the file (~/.history) to the history."""
    path = _history_file(filename)
    _sys.audit("open", "~/.history" if filename is None else filename, "r", 0)
    with _without_filename():
        if _os.path.isdir(path):
            raise OSError(22, _os.strerror(22))
        with open(path, "rb") as f:
            data = f.read()
    # A line ends with a newline: what comes after the last one is none.
    for line in data.split(b"\n")[:-1]:
        line = line.removesuffix(b"\r")
        if line:
            _history.append(line.decode("utf-8", "surrogateescape"))
    _forget_the_oldest()


def write_history_file(filename=None, /):
    """Write the history to the file (~/.history), in place of what it held."""
    path = _history_file(filename)
    _sys.audit("open", "~/.history" if filename is None else filename, "w", 0)
    with _without_filename():
        with open(_os.open(path, _os.O_WRONLY | _os.O_CREAT | _os.O_TRUNC, 0o600), "wb") as f:
            f.write(_lines(_history))
        _cut_to_history_length(path)


def append_history_file(nelements, filename=None, /):
    """Write the newest nelements items at the end of the file (~/.history), which has to exist."""
    nelements = _int(nelements)
    if nelements < 0:
        raise ValueError("nelements must be non-negative")
    path = _history_file(filename)
    _sys.audit("open", "~/.history" if filename is None else filename, "a", 0)
    with _without_filename():
        with open(_os.open(path, _os.O_WRONLY | _os.O_APPEND), "ab") as f:
            f.write(_lines(_history[max(len(_history) - nelements, 0) :]))
        _cut_to_history_length(path)


# ---- Completion and hooks ----


def set_completer(function=None, /):
    """The function is asked for the words that may stand for `text`: function(text, 0), function(text, 1), ... until it returns
    something that is no str. None: nothing is completed."""
    global _completer
    _completer = _callable_or_none("set_completer", function)


def get_completer():
    """What set_completer() was given last."""
    return _completer


def set_completer_delims(string, /):
    """The characters at which the word to complete begins."""
    global _completer_delims
    _completer_delims = _text(string)


def get_completer_delims():
    """What set_completer_delims() was given last."""
    return _completer_delims


def get_completion_type():
    """The key that asked for the completion: 9, Tab. 0 before there was any."""
    return _completion_type


def set_completion_display_matches_hook(function=None, /):
    """The function shows the matches, in place of the editor: function(word, matches, length_of_the_longest). None: the editor does."""
    global _display_matches_hook
    _display_matches_hook = _callable_or_none("set_completion_display_matches_hook", function)


def set_startup_hook(function=None, /):
    """The function is called, without arguments, before the prompt is shown. None: no function."""
    global _startup_hook
    _startup_hook = _callable_or_none("set_startup_hook", function)


def set_pre_input_hook(function=None, /):
    """The function is called, without arguments, when the prompt has been shown and before a key is read. None: no function."""
    global _pre_input_hook
    _pre_input_hook = _callable_or_none("set_pre_input_hook", function)


def get_pre_input_hook():
    """What set_pre_input_hook() was given last."""
    return _pre_input_hook


# ---- The line that is being edited ----


def get_line_buffer():
    """The line as it has been typed so far."""
    return _reader.get_unicode() if _reader is not None else ""


def insert_text(string, /):
    """As if the text had been typed where the cursor is."""
    _text(string)
    if _reading:
        _reader.insert(string)


def redisplay():
    """Show the line as it is now."""
    if _reading:
        _reader.refresh()


def get_endidx():
    """Where in the line the word to complete ends."""
    return _reader.pos if _reader is not None else 0


def get_begidx():
    """Where in the line the word to complete begins."""
    if _reader is None:
        return 0
    start = _reader.pos
    while start > 0 and _reader.buffer[start - 1] not in _completer_delims:
        start -= 1
    return start


# ---- Key bindings ----

# The functions of GNU readline whose names _pyrepl spells otherwise. Most it spells alike.
_COMMANDS = {
    "accept-line": "accept",
    "backward-delete-char": "backspace",
    "delete-char": "delete",
    "menu-complete": "complete",
    "reverse-search-history": "reverse-history-isearch",
    "forward-search-history": "forward-history-isearch",
    "tab-insert": "self-insert",
    "beginning-of-history": "first-history",
    "end-of-history": "last-history",
}
_KEY_NAMES = {
    "tab": "\\t",
    "return": "\\n",
    "ret": "\\n",
    "newline": "\\n",
    "lfd": "\\n",
    "esc": "\\e",
    "escape": "\\e",
    "space": " ",
    "spc": " ",
    "del": "\\<backspace>",
    "rubout": "\\<backspace>",
}


def _keys_of_name(name):
    """Control-x, M-C-a, Tab: how an init file names one key."""
    prefix = ""
    while True:
        modifier, _, rest = name.partition("-")
        if not rest:
            return prefix + _KEY_NAMES.get(name.lower(), name[:1])
        if modifier.lower() in ("control", "ctrl", "c"):
            prefix += "\\C-"
        elif modifier.lower() in ("meta", "m"):
            prefix = "\\M-" + prefix
        else:
            return None
        name = rest


def parse_and_bind(string, /):
    """One line of an init file.

    `key: function` and `"keys": function` bind what the editor has a command for, `key: "text"` makes the key insert the text. Of the
    variables (`set ...`) history-size, bell-style and those that say how matches are listed have an effect."""
    global _history_size
    line = _text(string).strip()
    if line.startswith("bind "):  # libedit's way to say it
        line = "tab: complete" if line.split() == ["bind", "^I", "rl_complete"] else ""
    if line.startswith(("set ", "set\t")):
        words = line.split()
        name, value = (words[1].lower(), words[2].lower()) if len(words) == 3 else ("", "")
        is_number = value.removeprefix("-").isdecimal()
        if name == "history-size" and is_number:
            _history_size = int(value)
            _forget_the_oldest()
        elif isinstance(_variables.get(name), bool):
            _variables[name] = value in ("on", "1")
        elif isinstance(_variables.get(name), int):
            if is_number:
                _variables[name] = int(value)
        elif name in _variables:
            _variables[name] = value
        return
    if not line or line.startswith(("#", "$")):
        return
    if line.startswith('"'):
        end = 1
        while end < len(line) and line[end] != '"':
            end += 2 if line[end] == "\\" else 1
        keys = line[1:end]
        function = line[end + 1 :].lstrip().removeprefix(":")
    else:
        name, _, function = line.partition(":")
        keys = _keys_of_name(name.strip())
    function = function.strip()
    if keys and function:
        _bind(keys, _COMMANDS.get(function, function))


def _bind(keys, command):
    if _bindings.get(keys) == command:
        return
    _bindings[keys] = command
    if _reader is None:
        return
    if command[0] in "\"'" and command[-1] == command[0] and len(command) > 1:
        _reader.commands[command] = _reader.make_macro(command[1:-1])
    if command in _reader.commands:
        keymap = _reader.keymap
        try:
            _reader.bind(keys, command)
        except Exception:  # Keys that are spelled wrong, or are the beginning of others that are bound.
            _reader.keymap = keymap


def read_init_file(filename=None, /):
    """parse_and_bind() for each line of the file ($INPUTRC, ~/.inputrc, /etc/inputrc), with its $if, $else and $endif."""
    _sys.audit("open", "<readline_init_file>" if filename is None else filename, "r", 0)
    if filename is None:
        filename = _os.environ.get("INPUTRC") or _os.path.join(_os.path.expanduser("~"), ".inputrc")
        if not _os.path.exists(filename):
            filename = "/etc/inputrc"
    with _without_filename():
        with open(_os.fspath(filename), encoding="utf-8", errors="surrogateescape") as f:
            lines = f.read().split("\n")
    skipping = []  # One for each $if that is open.
    for line in lines:
        word, _, rest = line.strip().partition(" ")
        if word == "$if":
            test = rest.strip().lower()
            skipping.append(test not in ("python", "mode=emacs"))
        elif word == "$else" and skipping:
            skipping[-1] = not skipping[-1]
        elif word == "$endif" and skipping:
            skipping.pop()
        elif not any(skipping) and "\0" not in line:
            parse_and_bind(line)


# ---- Reading a line ----


class _NoModules:
    """The interactive interpreter completes the names of modules after `import`. What is typed here need not be Python."""

    @staticmethod
    def get_completions(line, include_values=False):
        return None


def _complete(text, state):
    global _completion_type
    _completion_type = 9  # Tab
    return _completer(text, state) if _completer is not None else None


class _output_as_usual:
    """While the program's functions run: what they print has lines that begin at the margin, which the editor has turned off."""

    def __enter__(self):
        import termios

        self.state = termios.tcgetattr(1)
        usual = self.state[:]
        usual[1] |= termios.OPOST
        termios.tcsetattr(1, termios.TCSANOW, usual)

    def __exit__(self, *exception):
        import termios

        termios.tcsetattr(1, termios.TCSANOW, self.state)


def _run_hooks():
    for hook in (_startup_hook, _pre_input_hook):
        if hook is not None:
            try:
                with _output_as_usual():
                    hook()
            except Exception:  # Nobody hears of it, as with GNU's.
                pass


def _make_console(Console):
    """What the editor shows, written as GNU's writes it: text, backspaces, carriage returns and line feeds, and next to nothing else. A
    line longer than the terminal is wide goes on in the next row, if the terminal can go up a row and erase the rest of one. Of a
    terminal of which nothing is known (TERM is "dumb", or not set) one row is used, and shows a part of the line."""
    import dataclasses
    import termios

    from _pyrepl import keymap, terminfo
    from _pyrepl.render import render_cells
    from _pyrepl.unix_eventqueue import get_terminal_keycodes

    endless = 1 << 20  # The editor is not to break the line.

    class Plain(Console):
        columns = 80

        def __init__(self):
            # For what the keys send, which is known well enough.
            super().__init__(0, 1, term="xterm", encoding="utf-8")
            codes = get_terminal_keycodes(self.terminfo)
            for code, key in (("A", "up"), ("B", "down"), ("C", "right"), ("D", "left"), ("H", "home"), ("F", "end"), ("3~", "delete")):
                codes[b"\x1b[" + code.encode()] = key
            codes[termios.tcgetattr(0)[6][termios.VERASE]] = "backspace"
            self.event_queue.compiled_keymap = self.event_queue.keymap = keymap.compile_keymap(codes)
            try:
                can = terminfo.TermInfo(None).get
            except Exception:
                can = {}.get
            self.up, self.erase, self.clear_screen = ((can(name) or b"").decode("latin-1") for name in ("cuu1", "el", "clear"))
            self.wraps = bool(self.up and self.erase)
            self.forget()

        def forget(self):
            self.above = 0  # So many lines of the prompt have been written.
            self.below = ()  # What was last written under the line.
            self.shown = ()  # The cells on the terminal,
            self.starts = [0]  # where each begins and the last ends, in columns from the beginning of the line through all its rows,
            self.at = 0  # and where the cursor is.
            self.first = 0  # The first cell of the line that is shown.

        def write(self, text):
            if text:
                _os.write(1, text.encode("utf-8", "replace"))

        def getheightwidth(self):
            height, self.columns = super().getheightwidth()
            return height, endless

        # What the console would have done to the terminal is not done.
        def flushoutput(self):
            del self._UnixConsole__buffer[:]

        def _UnixConsole__enable_bracketed_paste(self):
            pass

        def _UnixConsole__disable_bracketed_paste(self):
            pass

        def set_cursor_vis(self, visible):
            pass

        def prepare(self):
            super().prepare()
            self.flushoutput()
            self.forget()

        def refresh(self, rendered):
            lines = rendered.composed_lines
            x, y = rendered.cursor
            for line in lines[self.above : y]:
                self.write(line.text + "\r\n")
            self.above = max(self.above, y)
            below = tuple(line.text for line in lines[y + 1 :])
            while below and not below[-1]:
                below = below[:-1]
            if below and below != self.below:
                self.go_to_last_row()
                self.write("\r\n" + "\r\n".join(below) + "\r\n")
                self.shown, self.starts, self.at = (), [0], 0
            self.below = below
            self.show(lines[y].cells if y < len(lines) else (), x)
            self.sync_rendered_screen(rendered, rendered.cursor)

        def show(self, cells, x):
            cursor, width = 0, 0  # The cell under the cursor.
            while cursor < len(cells) and width < x:
                width += cells[cursor].width
                cursor += 1
            cells = list(cells)
            room = max(self.columns - 1, 8)
            if self.wraps or sum(cell.width for cell in cells) <= room:
                self.first = 0
            else:
                # A part that has the cursor in it. It moves by a third of the width at a time.
                while cursor < self.first + (self.first > 0):
                    self.first = max(self.first - room // 3, 0)
                while sum(cell.width for cell in cells[self.first : cursor + 1]) >= room:
                    self.first += room // 3
                cursor -= self.first
                rest, cells, width = cells[self.first :], [], 0
                for cell in rest:
                    if width + cell.width > room:
                        break
                    width += cell.width
                    cells.append(cell)
                if len(cells) < len(rest):
                    cells[-1] = dataclasses.replace(cells[-1], text=">".ljust(cells[-1].width), controls=())
                if self.first:
                    cells[0] = dataclasses.replace(cells[0], text="<".ljust(cells[0].width), controls=())

            starts, at = [], 0
            for i, cell in enumerate(cells):
                if cell.text == "^I":  # A tab.
                    cells[i] = cell = dataclasses.replace(cell, text=" " * (8 - at % 8), width=8 - at % 8)
                if self.wraps and at % self.columns + cell.width > self.columns:
                    at += self.columns - at % self.columns
                starts.append(at)
                at += cell.width
            starts.append(at)

            same = 0
            while same < len(cells) and same < len(self.shown) and cells[same] == self.shown[same] and starts[same] == self.starts[same]:
                same += 1
            end = self.starts[-1]
            if same < len(cells) or end > at:
                self.go_to(starts[same])
            self.shown, self.starts = tuple(cells), starts
            if same < len(cells):
                self.write(render_cells(cells[same:]))
                self.at = at
                if self.wraps and at % self.columns == 0:
                    self.write(" \r")  # Until something more is written the cursor stays in the last column.
            if end > at:
                self.erase_to(end)
            self.go_to(starts[cursor])

        def erase_to(self, end):
            if not self.wraps:
                return self.write(" " * (end - self.at) + "\b" * (end - self.at))
            self.write(self.erase)
            for _ in range(end // self.columns - self.at // self.columns):
                self.write("\n\r" + self.erase)
                self.at += self.columns - self.at % self.columns

        def go_to(self, at):
            columns = self.columns if self.wraps else endless
            rows = at // columns - self.at // columns
            self.write(self.up * -rows + "\n" * rows)
            self.at += rows * columns
            self.write("\b" * (self.at - at))
            self.write(render_cells([cell for cell, start in zip(self.shown, self.starts) if self.at <= start < at]))
            self.at = at

        def move_cursor(self, x, y):
            self.refresh(dataclasses.replace(self._rendered_screen, cursor=(x, y)))

        def go_to_last_row(self):
            if self.wraps:
                self.write("\n" * (self.starts[-1] // self.columns - self.at // self.columns))

        def finish(self):
            self.go_to_last_row()
            self.write("\r\n")
            self.forget()

        def clear(self):
            self.write(self.clear_screen or "\r\n")
            self.forget()
            self.invalidate_render_state()

        def repaint(self):
            end = self.starts[-1]
            self.go_to(0)
            self.shown, self.starts = (), [0]
            self.erase_to(end)
            self.go_to(0)
            self.refresh(self._rendered_screen)

        def beep(self):
            self.write("\a")

    return Plain()


def _make_reader():
    global _reader, _completer, _when_continued
    import signal

    # It imports rlcompleter, which sets a completer when it is imported. That is for the program to ask for.
    completer = _completer
    from _pyrepl import commands, historical_reader
    from _pyrepl.readline import Console, ReadlineAlikeReader, ReadlineConfig

    _completer = completer

    class Reader(ReadlineAlikeReader):
        def get_completions(self, stem):
            with _output_as_usual():
                matches, action = super().get_completions(stem)
            # A match takes the place of the word, whether or not it begins with what was typed: "sel", "SELECT".
            common = _os.path.commonprefix(matches)
            if matches and not common.startswith(stem) and (len(matches) == 1 or len(common) >= len(stem)):
                start = self.pos - len(stem)
                self.buffer[start : self.pos] = common[: len(stem)]
                self.pos = start + min(len(common), len(stem))
                self.invalidate_buffer(start)
            return matches, action

        @staticmethod
        def make_macro(text):
            class macro(commands.Command):
                def do(self):
                    self.reader.insert(text)

            return macro

        def select_item(self, i):
            # Otherwise it comes without the blanks at its end.
            if i < len(self.history):
                self.transient_history.setdefault(i, self.history[i])
            super().select_item(i)

    class delete(commands.delete):
        # At the end of the input the cursor stays where it is: who catches the EOFError goes to the next line.
        def do(self):
            if not self.reader.buffer and self.event[-1] == "\004":
                raise EOFError
            super().do()

    class complete(commands.Command):
        # As GNU's: what the matches have in common is inserted. If that leaves the line as it was, the bell rings, and the next Tab
        # lists the matches under the line, which is then written again.
        def do(self):
            reader = self.reader
            lists = reader.last_command_is(type(self)) and reader.tab_changed_nothing
            reader.tab_changed_nothing = False
            before = reader.buffer[:]
            stem = reader.get_stem()
            matches = list(dict.fromkeys(reader.get_completions(stem)[0]))
            if not matches:
                return ring()
            if lists:
                return self.list(matches)
            reader.insert(_os.path.commonprefix(matches)[len(stem) :])
            if len(matches) == 1:
                return
            reader.tab_changed_nothing = reader.buffer == before
            if _variables["show-all-if-ambiguous"] or (_variables["show-all-if-unmodified"] and reader.tab_changed_nothing):
                return self.list(matches)
            ring()

        def list(self, matches):
            reader = self.reader
            console = reader.console
            longest = max(map(len, matches))
            console.go_to_last_row()
            console.restore()
            try:
                if _display_matches_hook is not None:
                    try:
                        _display_matches_hook(reader.get_stem(), matches, longest)
                    except Exception:
                        pass
                    # It may have written the prompt and the line again, as it has to with GNU's.
                    _os.write(1, ("\r" + console.erase if console.wraps else "\r\n").encode())
                    return
                limit = _variables["completion-query-items"]
                if 0 < limit <= len(matches):
                    # As under CPython, which has GNU's call it back for each key: then the question is not waited for.
                    _os.write(1, b"\nDisplay all %d possibilities? (y or n)" % len(matches))
                width = _os.get_terminal_size(1).columns
                if 0 <= _variables["completion-display-width"] <= width:
                    width = _variables["completion-display-width"]
                columns = width // (longest + 2)
                if columns != 1 and columns * (longest + 2) == width:
                    columns -= 1
                columns = max(columns, 1)
                rows = (len(matches) + columns - 1) // columns
                if _variables["print-completions-horizontally"]:
                    table = [matches[i : i + columns] for i in range(0, len(matches), columns)]
                else:
                    table = [matches[i::rows] for i in range(rows)]
                text = "".join("".join(match.ljust(longest + 2) for match in row[:-1]) + row[-1] + (" " * (longest + 2 - len(row[-1])) if len(row) < columns else "") + "\n" for row in table)
                _os.write(1, ("\n" + text).encode("utf-8", "replace"))
            finally:
                console.prepare()
                reader.invalidate_full()

    def ring():
        if _variables["bell-style"] != "none":
            _reader.console.beep()

    class transpose_characters(commands.transpose_characters):
        # At the end of the line: the two before it.
        def do(self):
            reader = self.reader
            if not reader.pos or len(reader.buffer) < 2:
                return ring()
            if reader.pos == len(reader.buffer):
                reader.pos -= 1
            super().do()
            reader.pos += 1

    class isearch_end(historical_reader.isearch_end):
        # Return ends the search and takes the line that was found.
        def do(self):
            super().do()
            self.finish = self.event[-1] in "\r\n"

    # The console sets a handler for good. It is wanted while a line is read.
    handler = signal.getsignal(signal.SIGCONT)
    try:
        console = _make_console(Console)
        _when_continued = signal.getsignal(signal.SIGCONT)
    finally:
        signal.signal(signal.SIGCONT, handler)
    _reader = Reader(console=console, config=ReadlineConfig(readline_completer=_complete, module_completer=_NoModules))
    _reader.history = _history
    _reader.can_colorize = False
    _reader.tab_changed_nothing = False
    _reader.commands["delete"] = delete
    _reader.commands["complete"] = complete
    _reader.commands["transpose-characters"] = _reader.commands["transpose_characters"] = transpose_characters
    _reader.commands["isearch-end"] = _reader.commands["isearch_end"] = isearch_end
    # Until somebody binds it, Tab is a character like any other. The user's init file comes before what the program has asked for.
    asked_for = list(_bindings.items())
    _bindings.clear()
    for keys, command in (("\\t", "self-insert"), ("\\M-\\t", "complete"), ("\\e\\e", "complete")):
        _bind(keys, command)
    try:
        read_init_file()
    except OSError:
        pass
    for keys, command in asked_for:
        _bind(keys, command)


def _read_line(prompt):
    """A line from the terminal, without its end. NotImplemented: not here (no terminal after all, a thread that cannot set handlers
    of signals, as the editor does)."""
    global _reading
    import _thread
    import signal

    if _reading or _thread.get_ident() != _thread._get_main_thread_ident():
        return NotImplemented
    if _reader is None:
        from _pyrepl.unix_console import _error

        try:
            _make_reader()
        except _error:
            return NotImplemented
    _reader.config.completer_delims = frozenset(_completer_delims)
    _reader.ps1 = prompt
    _reading = True
    handler = signal.signal(signal.SIGCONT, _when_continued)
    try:
        # The editor would add every line, and keep what was changed in older ones.
        with _reader.suspend_history_writes():
            line = _reader.readline(startup_hook=_run_hooks)
    finally:
        signal.signal(signal.SIGCONT, handler)
        _reading = False
    if _auto_history and line and _history[-1:] != [line]:
        _history.append(line)
        _forget_the_oldest()
    return line
