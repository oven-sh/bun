"""The interactive interpreter on a terminal: the standard library's (_pyrepl), in which `await` also works at the top level."""

import ast
import inspect

from _pyrepl import console, main


class Console(console.InteractiveColoredConsole):
    _runner = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.compile.compiler.flags |= ast.PyCF_ALLOW_TOP_LEVEL_AWAIT

    def runcode(self, code):
        if not code.co_flags & inspect.CO_COROUTINE:
            return super().runcode(code)
        try:
            if self._runner is None:
                import asyncio

                # One loop for the session, so that what one statement starts the next finds running.
                self._runner = asyncio.Runner()
            self._runner.run(eval(code, self.locals))
        except SystemExit:
            raise
        except BaseException:
            self.showtraceback()
            return self.STATEMENT_FAILED
        return None


def interactive_console(mainmodule=None, quiet=False, pythonstartup=False):
    # It looks the class up there when it is called.
    console.InteractiveColoredConsole = Console
    return main.interactive_console(mainmodule, quiet, pythonstartup)
