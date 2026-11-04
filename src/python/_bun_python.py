"""What `bun:python` gives JavaScript that is best said in Python: the statements JavaScript has no counterpart for."""

import _js


def _leave(exits, exception=None):
    """What leaving the `with` statements does, the last that was entered first. An exception that no manager swallows is raised."""
    while exits:
        exit = exits.pop()
        if exception is None:
            try:
                exit(None, None, None)
            except BaseException as raised:
                exception = raised
            continue
        traceback = exception.__traceback__
        try:
            # It is being handled while the manager looks at it.
            raise exception
        except BaseException:
            exception.__traceback__ = traceback
            try:
                if exit(type(exception), exception, traceback):
                    exception = None
            except BaseException as raised:
                exception = raised
    if exception is not None:
        raise exception


def with_(*arguments):
    """with(a, b, body) is `with a as x, b as y: return body(x, y)`.

    If the body returns a promise, as an async function does, the block lasts until that is settled.
    """
    *managers, body = arguments
    exits = []
    try:
        values = []
        for manager in managers:
            exit = _js.special_method(manager, "__exit__")
            enter = _js.special_method(manager, "__enter__")
            if enter is None or exit is None:
                # For what the statement has to say to that.
                with manager:
                    pass
            values.append(enter())
            exits.append(exit)
        result = body(*values)
    except BaseException as exception:
        raised = exception
    else:
        raised = None
    # Not in the handler: a manager that swallows the exception ends the handling of it.
    if raised is not None or not isinstance(result, _js.JSPromise):
        _leave(exits, raised)
        return None if raised is not None else result

    def fulfilled(value=None):
        _leave(exits)
        return value

    def rejected(reason=None):
        _leave(exits, _js.exception_for(reason))

    return result.then(fulfilled, rejected)


async def _inside(managers, values, body):
    if len(values) == len(managers):
        result = body(*values)
        return await result if hasattr(type(result), "__await__") else result
    async with managers[len(values)] as value:
        return await _inside(managers, [*values, value], body)


async def async_with(*arguments):
    """asyncWith(a, b, body) is `async with a as x, b as y: return await body(x, y)`, all of it in one task."""
    *managers, body = arguments
    return await _inside(managers, [], body)
