// answers: without-library
// # A call in tail position of strict code leaves no frame, also where native code called the function that makes it: a conversion, a getter, toJSON. A call that stands in a try keeps its frame.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 8 of 8 of 8
// # CHECK-NEXT: exited with 0
function fail() { throw new Error("fail"); }
function framesOf(error) { const lines = error.stack.split("\n"); let text = ""; for (let index = 0; index < lines.length; index++) { const name = lines[index].split("@")[0]; text += name + "<"; if (name.startsWith("top")) break; } return text; }
function topTemplate() { try { return `${{ toString: () => fail() }}`; } catch (error) { return framesOf(error); } }
report(topTemplate());
function topArrow() { const arrow = () => fail(); try { return arrow() + 1; } catch (error) { return framesOf(error); } }
report(topArrow());
function named() { return fail(); }
function topNamed() { try { return named() + 1; } catch (error) { return framesOf(error); } }
report(topNamed());
function topSum() { try { return { valueOf: () => fail() } + 1; } catch (error) { return framesOf(error); } }
report(topSum());
function topGetter() { try { return { get member() { return fail(); } }.member + 1; } catch (error) { return framesOf(error); } }
report(topGetter());
function topWritten() { try { return JSON.stringify({ toJSON: () => fail() }); } catch (error) { return framesOf(error); } }
report(topWritten());
function inTry() { try { return fail(); } finally { } }
function topInTry() { try { return inTry() + 1; } catch (error) { return framesOf(error); } }
report(topInTry());
report("end");
