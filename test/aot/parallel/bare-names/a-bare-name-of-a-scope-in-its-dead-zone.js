// The same for a binding of a function's scope, a const, a class, and below operators that `bun <file>` takes apart.
function make(base) {
  const out = [touch(), both(), chosen(base), named()];
  const held = base + 1;
  class Made {}
  out.push(touch(), both(), chosen(base), named());
  return out.join();
  function touch() { try { held; return "quiet"; } catch (e) { return e.name; } }
  function both() { try { held, held; void held; !held; return "quiet"; } catch (e) { return e.name; } }
  function chosen(c) { try { c ? held : held; return "quiet"; } catch (e) { return e.name; } }
  function named() { try { Made; return "quiet"; } catch (e) { return e.name; } }
}
for (let round = 0; round < 3; round++) console.log(make(round));
