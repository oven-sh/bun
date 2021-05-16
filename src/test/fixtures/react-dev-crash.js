try {
  // This should throw.
  if (construct) {
    // Something should be setting the props in the constructor.
    var Fake = function () {
      throw Error();
    }; // $FlowFixMe

    Object.defineProperty(Fake.prototype, "props", {
      set: function () {
        // We use a throwing setter instead of frozen or non-writable props
        // because that won't throw in a non-strict mode function.
        throw Error();
      },
    });

    if (typeof Reflect === "object" && Reflect.construct) {
      // We construct a different control for this case to include any extra
      // frames added by the construct call.
      try {
        Reflect.construct(Fake, []);
      } catch (x) {
        control = x;
      }

      Reflect.construct(fn, [], Fake);
    } else {
      try {
        Fake.call();
      } catch (x) {
        control = x;
      }

      fn.call(Fake.prototype);
    }
  } else {
    try {
      throw Error();
    } catch (x) {
      control = x;
    }

    fn();
  }
} catch (sample) {
  // This is inlined manually because closure doesn't do it for us.
  if (sample && control && typeof sample.stack === "string") {
    // This extracts the first frame from the sample that isn't also in the control.
    // Skipping one frame that we assume is the frame that calls the two.
    var sampleLines = sample.stack.split("\n");
    var controlLines = control.stack.split("\n");
    var s = sampleLines.length - 1;
    var c = controlLines.length - 1;

    while (s >= 1 && c >= 0 && sampleLines[s] !== controlLines[c]) {
      // We expect at least one stack frame to be shared.
      // Typically this will be the root most one. However, stack frames may be
      // cut off due to maximum stack limits. In this case, one maybe cut off
      // earlier than the other. We assume that the sample is longer or the same
      // and there for cut off earlier. So we should find the root most frame in
      // the sample somewhere in the control.
      c--;
    }

    for (; s >= 1 && c >= 0; s--, c--) {
      // Next we find the first one that isn't the same which should be the
      // frame that called our sample function and the control.
      if (sampleLines[s] !== controlLines[c]) {
        // In V8, the first line is describing the message but other VMs don't.
        // If we're about to return the first line, and the control is also on the same
        // line, that's a pretty good indicator that our sample threw at same line as
        // the control. I.e. before we entered the sample frame. So we ignore this result.
        // This can happen if you passed a class to function component, or non-function.
        if (s !== 1 || c !== 1) {
          do {
            s--;
            c--; // We may still have similar intermediate frames from the construct call.
            // The next one that isn't the same should be our match though.

            if (c < 0 || sampleLines[s] !== controlLines[c]) {
              // V8 adds a "new" prefix for native classes. Let's remove it to make it prettier.
              var _frame = "\n" + sampleLines[s].replace(" at new ", " at ");

              {
                if (typeof fn === "function") {
                  componentFrameCache.set(fn, _frame);
                }
              } // Return the line we found.

              return _frame;
            }
          } while (s >= 1 && c >= 0);
        }

        break;
      }
    }
  }
} finally {
  reentry = false;

  {
    ReactCurrentDispatcher$1.current = previousDispatcher;
    reenableLogs();
  }

  Error.prepareStackTrace = previousPrepareStackTrace;
} // Fallback to just using the name if we couldn't make it throw.
