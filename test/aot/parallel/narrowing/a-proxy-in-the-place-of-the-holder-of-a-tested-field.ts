// the holder of a tested field is a Proxy: the read of the tag and the read behind the test each go through the trap, in that order
type Hit = { ok: true; value: string };
type Miss = { ok: false; error: string };

function unwrap(r: Hit | Miss): unknown {
  if (r.ok) return r.value;
  return r.error;
}

const log: string[] = [];
function deed(target: Hit | Miss): Hit | Miss {
  return new Proxy(target, {
    get(inner, key, receiver) {
      log.push(String(key));
      return Reflect.get(inner, key, receiver);
    },
  });
}

const hit: Hit = { ok: true, value: "value" };
const miss: Miss = { ok: false, error: "error" };
console.log(String(unwrap(hit)), String(unwrap(miss)));
let seen = "";
for (let i = 0; i < 300; i++) seen = String(unwrap(i % 2 ? hit : miss));
console.log(seen);
console.log(String(unwrap(deed(hit))), log.join());
for (let i = 0; i < 3; i++) console.log(String(unwrap(i === 1 ? deed(miss) : hit)), log.join());
