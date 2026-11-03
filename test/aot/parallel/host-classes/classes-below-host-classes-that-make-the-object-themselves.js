// The constructors of these host classes make the object themselves and may keep it, so the compiler does not follow what `new` answers.
// A class below one of them keeps its own methods, getters, setters and fields all the same.
// Each line has a class of its own: what one line does with a class says nothing about the class of another.
const { SourceMap } = require("node:module");
function tell(what, ask) {
  try { console.log(what, ask()); } catch (error) { console.log(what, "threw", error.constructor.name, error.message); }
}
const bytes = () => new Uint8Array(2);

class WithMethod extends Bun.Image { label() { return "mine"; } }
tell("method", () => new WithMethod(bytes()).label());

class WithGetter extends Bun.Image { get kind() { return "mine too"; } }
tell("getter", () => new WithGetter(bytes()).kind);

class WithConstructor extends Bun.Image { constructor(input) { super(input); this.own = 1; } read() { return this.own; } }
tell("constructor", () => new WithConstructor(bytes()).read());

class WithText extends Bun.Image { toString() { return "text"; } }
tell("toString", () => `${new WithText(bytes())}`);

class HandedOn extends Bun.Image { label() { return "handed on"; } }
function handOn(object) { return object.label(); }
tell("handed on", () => handOn(new HandedOn(bytes())));

class InTry extends Bun.Image { label() { return "no fall-back"; } }
tell("in a try", () => { try { return new InTry(bytes()).label(); } catch { return "fall-back"; } });

class Tested extends Bun.Image { label() { return "tested"; } }
tell("instanceof", () => { const image = new Tested(bytes()); return [image instanceof Tested, image instanceof Bun.Image, image instanceof WithText, image.label()].join(); });

class WithField extends Bun.Image { field = "a field"; read() { return this.field; } }
tell("field", () => new WithField(bytes()).read());

class WithPrivateName extends Bun.Image { #hidden = "hidden"; hidden() { return this.#hidden; } }
tell("private name", () => new WithPrivateName(bytes()).hidden());

class WithSetter extends Bun.Image { set value(given) { this.kept = given; } }
tell("setter", () => { const image = new WithSetter(bytes()); image.value = "set"; return image.kept; });

class MadeByItself extends Bun.Image { label() { return "made by a static method"; } static make() { return new MadeByItself(bytes()); } }
tell("static method", () => MadeByItself.make().label());

class Upper extends Bun.Image { label() { return "upper"; } }
class Lower extends Upper { label() { return "lower and " + super.label(); } }
tell("two levels", () => new Lower(bytes()).label());

class Flipped extends Bun.Image { label() { return "flipped"; } }
tell("behind a method of the host class", () => new Flipped(bytes()).flip().label());

class Measured extends Bun.Image { twice() { return this.width * 2; } }
tell("member of the host class", () => new Measured(bytes()).twice());

class Reflected extends Bun.Image { label() { return "reflected"; } }
tell("Reflect.construct", () => Reflect.construct(Bun.Image, [bytes()], Reflected).label());

class Session extends Bun.FetchSession { constructor() { super(); this.own = 2; } label() { return "a session's"; } get kind() { return this.own; } }
tell("FetchSession", () => { const session = new Session(); return [session.label(), session.kind, session instanceof Bun.FetchSession].join(); });

class Client extends Bun.RedisClient { label() { return "a client's"; } get kind() { return "and its getter"; } }
tell("RedisClient", () => {
  const client = new Client("redis://localhost:1");
  try { return [client.label(), client.kind, client.connected].join(); } finally { client.close(); }
});

class Pty extends Bun.Terminal { label() { return "a terminal's"; } get kind() { return "and its getter"; } }
tell("Terminal", () => {
  const terminal = new Pty({});
  try { return [terminal.label(), terminal.kind].join(); } finally { terminal.close(); }
});

class Positions extends SourceMap { label() { return "a map's"; } get kind() { return this.payload.version; } }
tell("SourceMap", () => { const map = new Positions({ version: 3, sources: [], names: [], mappings: "" }); return [map.label(), map.kind].join(); });
