// Tokens move from one holder to another, so that each is referred to from one place only, while the holders change
// their layout in all the ways that they can.
(function (steps, seed, copies) {
  const random = limit => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return (seed >>> 7) % limit;
  };
  // A later store would make up for what a marker has missed, so for a while there is one kind of change only.
  let phase = 0;
  let made = 0;
  const token = () => ({ id: made, text: "token " + made++, nested: [{}] });
  const check = it => {
    if (it.text !== "token " + it.id || typeof it.nested[0] !== "object") throw new Error("broken " + it.id);
    return it;
  };
  const byId = (a, b) => a.id - b.id;

  const list = (length, put, take) => () => {
    const array = Array.from({ length }, token);
    return {
      size: () => array.length,
      put: it => put(array, it),
      take: () => take(array),
      stir() {
        const at = random(array.length + 1);
        switch (phase % 8) {
          case 0:
            return array.reverse();
          case 1:
            return array.length < 300 && array.sort(byId);
          case 2:
            return array.push(...array.splice(at, 3));
          case 3:
            return array.unshift(...array.splice(at, 3));
          case 4:
            return array.splice(at, 0, ...array.splice(0, 2));
          case 5:
            array.length += 40;
            return (array.length -= 40);
          case 6:
            array["name" + random(20)] = at;
            return delete array["name" + random(20)];
          default: {
            const first = array[0];
            array.copyWithin(0, 1);
            if (first) array[array.length - 1] = first;
          }
        }
      },
    };
  };
  const push = (array, it) => array.push(it);
  const unshift = (array, it) => array.unshift(it);
  const pop = array => array.pop();
  const shift = array => array.shift();

  const keyed = (create, set, remove, stir) => () => {
    let store = create();
    const keys = [];
    let next = 0;
    return {
      size: () => keys.length,
      put(it) {
        keys.push(next);
        set(store, next++, it);
      },
      take: () => remove(store, keys.splice(random(keys.length), 1)[0]),
      stir: () => (store = stir(store) ?? store),
    };
  };
  const setNamed = (object, key, it) => (object["key" + key] = it);
  const removeNamed = (object, key) => {
    const it = object["key" + key];
    delete object["key" + key];
    return it;
  };
  const removeFromMap = (map, key) => {
    const it = map.get(key);
    map.delete(key);
    return it;
  };

  const single = (create, exchange) => () => {
    const holder = create();
    let size = 0;
    return {
      capacity: 1,
      size: () => size,
      put: it => (exchange(holder, it), (size = 1)),
      take: () => ((size = 0), exchange(holder, undefined)),
      stir() {},
    };
  };
  class Private {
    #value;
    exchange(it) {
      const old = this.#value;
      this.#value = it;
      return old;
    }
  }
  function* keep() {
    let kept;
    for (;;) {
      const old = kept;
      kept = yield old;
      yield old;
    }
  }
  const exchangeProperty = (object, it) => {
    const old = object.value;
    object.value = it;
    return old;
  };
  const weakKeys = Array.from({ length: 64 }, () => ({}));

  const kinds = [
    list(3, push, pop),
    list(20, push, shift),
    list(700, push, shift),
    list(700, unshift, pop),
    list(3000, unshift, shift),
    keyed(() => ({}), setNamed, removeNamed, object => (random(9) ? undefined : { ...object })),
    keyed(() => Object.create(null), setNamed, removeNamed, object => void Object.setPrototypeOf(object, {})),
    keyed(() => function () {}, setNamed, removeNamed, object => void object.prototype),
    keyed(
      () => [1, 2.5],
      (array, key, it) => (array[key * 5000 + 2] = it),
      (array, key) => {
        const it = array[key * 5000 + 2];
        delete array[key * 5000 + 2];
        return it;
      },
      () => {},
    ),
    keyed(() => new Map(), (map, key, it) => map.set(key, it), removeFromMap, map => (random(9) ? undefined : new Map(map))),
    keyed(
      () => new Map(),
      (map, key, it) => map.set("key" + key, new Set([it])),
      (map, key) => [...removeFromMap(map, "key" + key)][0],
      map => void map.keys().next(),
    ),
    keyed(
      () => weakKeys.map(() => new WeakMap()),
      (maps, key, it) => (maps[key >> 6] ??= new WeakMap()).set(weakKeys[key & 63], it),
      (maps, key) => removeFromMap(maps[key >> 6], weakKeys[key & 63]),
      () => {},
    ),
    single(() => new Private(), (holder, it) => holder.exchange(it)),
    single(
      () => {
        let variable;
        return it => ([variable, it] = [it, variable])[1];
      },
      (closure, it) => {
        const old = closure(undefined);
        closure(it);
        return old;
      },
    ),
    single(
      () => {
        const generator = keep();
        generator.next();
        return generator;
      },
      (generator, it) => {
        const old = generator.next(it).value;
        generator.next();
        return old;
      },
    ),
    single(() => new Proxy({}, {}), exchangeProperty),
    single(() => new Uint8Array(random(2000)), (view, it) => (random(9) || view.buffer, exchangeProperty(view, it))),
    single(() => new Error("message"), (error, it) => (random(9) || error.stack, exchangeProperty(error, it))),
    single(
      () => ({ bound: () => {} }),
      (holder, it) => {
        const old = holder.bound();
        holder.bound = (value => value).bind(null, it);
        return old;
      },
    ),
    single(
      () =>
        (function (a) {
          return arguments;
        })(undefined),
      (mapped, it) => ([mapped[0], it] = [it, mapped[0]]) && it,
    ),
    single(
      () => ({}),
      (holder, it) => {
        const old = holder.value;
        Object.defineProperty(holder, "value", { get: () => it, configurable: true });
        return old;
      },
    ),
  ];

  const holders = Array.from({ length: kinds.length * copies }, (_, index) => kinds[index % kinds.length]());
  const inTransit = [];
  let rope = "";
  for (let step = 0; step < steps; step++) {
    if (step % 300 === 0) phase = random(32);
    const holder = holders[random(holders.length)];
    if (phase < 16) holder.stir();
    else if (phase < 24) holder.size() && inTransit.push(check(holder.take()));
    else if (inTransit.length && holder.size() !== holder.capacity) holder.put(inTransit.pop());
    rope = random(50) ? rope + step : rope.charCodeAt(0) + "";
    if (!random(200)) JSON.parse(JSON.stringify([step, { rope }]));
  }
  const seen = new Set(inTransit.map(it => check(it).id));
  for (const holder of holders) while (holder.size()) seen.add(check(holder.take()).id);
  return made - seen.size;
});
