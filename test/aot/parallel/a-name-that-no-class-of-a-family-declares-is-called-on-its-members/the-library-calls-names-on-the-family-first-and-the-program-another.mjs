// STATISTIC: SharedCallsWithDormantMembers >= 2
import { once } from 'node:events'
class Base { a = 1 }
class Told extends Base {
  on(n, f) { return this }
  once(n, f) { if (n === 'x') f(7); return this }
  removeListener() { return this }
}
class Bare extends Base { b = 2 }
class Bare2 extends Base { b = 3 }
class Bare3 extends Base { b = 4 }
class Bare4 extends Bare { c = 5 }
class Bare5 extends Base { b = 6 }
const all = [new Told, new Bare, new Bare2, new Bare3, new Bare4, new Bare5]
const pick = i => all[i % all.length]
const first = await once(pick(0), 'x')
const word = ['Ma', 'th'].join(process.argv[9] ?? '')
Object.setPrototypeOf(all[1], globalThis[word])
function ask(o) { try { return o.hypot(3, 4) } catch (e) { return e.constructor.name } }
console.log(JSON.stringify(['SAID', first[0], all.map((_, i) => ask(pick(i))), all[1].b]))
