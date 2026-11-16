// `this.owner.method()` in what a loop of a method of the owner calls: the copies go on with the owner of the loop where it is the same object.
function Owner(name) { this.name = name; this.list = null; this.current = null; this.held = 0; this.sent = 0; this.lastId = null; this.blocks = []; }
Owner.prototype.add = function (id, task) { this.current = new Block(this.list, id, task); this.list = this.current; this.blocks[id] = this.current; };
Owner.prototype.run = function (most) {
  let turns = 0;
  this.current = this.list;
  while (this.current != null && turns < most) {
    turns++;
    if (this.current.isHeld()) this.current = this.current.link;
    else { this.lastId = this.current.id; this.current = this.current.run(); }
  }
  return turns;
};
Owner.prototype.hold = function () { this.held++; this.current.state = this.current.state | 4; return this.current.link; };
Owner.prototype.suspend = function () { this.current.state = this.current.state | 2; return this.current; };
Owner.prototype.release = function (id) {
  const block = this.blocks[id];
  if (block == null) return block;
  block.state = block.state & ~4;
  return block.id > this.current.id ? block : this.current;
};
Owner.prototype.send = function (packet) {
  const block = this.blocks[packet.id];
  if (block == null) return block;
  this.sent++;
  packet.id = this.lastId;
  return block.take(this.current, packet);
};
function Block(link, id, task) { this.link = link; this.id = id; this.task = task; this.state = 0; this.queue = null; }
Block.prototype.isHeld = function () { return (this.state & 4) != 0 || this.state == 2; };
Block.prototype.run = function () {
  let packet = null;
  if (this.queue != null) { packet = this.queue; this.queue = packet.link; this.state = this.queue == null ? 0 : 1; }
  return this.task.step(packet);
};
Block.prototype.take = function (block, packet) {
  if (this.queue == null) { this.queue = packet; this.state = this.state & ~2; return this.id > block.id ? this : block; }
  packet.link = this.queue; this.queue = packet;
  return block;
};
function Packet(link, id) { this.link = link; this.id = id; this.value = 0; }
function Idle(owner, count) { this.owner = owner; this.count = count; }
Idle.prototype.step = function (packet) { if (--this.count <= 0) return this.owner.hold(); return this.owner.release((this.count & 1) + 1); };
function Worker(owner, other) { this.owner = owner; this.other = other; this.seen = 0; }
Worker.prototype.step = function (packet) { if (packet == null) return this.owner.suspend(); this.seen++; packet.id = this.other; packet.link = null; return this.owner.send(packet); };
function Device(owner) { this.owner = owner; this.kept = null; this.steps = 0; }
Device.prototype.step = function (packet) {
  this.steps++;
  if (packet == null) { if (this.kept == null) return this.owner.suspend(); const kept = this.kept; this.kept = null; kept.id = 1; return this.owner.send(kept); }
  this.kept = packet; packet.link = null;
  return this.owner.hold();
};
function build(name, count) {
  const owner = new Owner(name);
  owner.add(0, new Idle(owner, count));
  owner.add(1, new Worker(owner, 2));
  owner.add(2, new Device(owner));
  owner.blocks[1].queue = new Packet(new Packet(null, 1), 1);
  return owner;
}
const out = [];
const tell = (what, owner) => out.push(`${what} ${owner.name}: ${owner.held} ${owner.sent} ${owner.lastId} ${owner.current === null ? null : owner.current === undefined ? undefined : owner.current.id} ${owner.blocks.map(b => b ? b.state + (b.queue ? "q" : "") : b)}`);
const first = build("first", 400), second = build("second", 90);
out.push(first.run(5000), second.run(5000));
tell("alone", first); tell("alone", second);
// The tasks of one belong to the other.
const crossed = build("crossed", 60), far = build("far", 60);
for (const block of crossed.blocks) block.task.owner = far;
out.push(crossed.run(300)); tell("crossed", crossed); tell("crossed", far);
// The owner changes while the loop runs, and comes back.
const changing = build("changing", 200);
const ownStep = changing.blocks[0].task.step;
changing.blocks[0].task.step = function (packet) { this.owner = this.count % 3 ? changing : far; return ownStep.call(this, packet); };
out.push(changing.run(400)); tell("changing", changing); tell("changing", far);
// A block that is not there, undefined and null.
for (const nothing of [undefined, null]) { const owner = build("missing", 50); owner.blocks[1] = nothing; out.push(owner.run(200)); tell("missing", owner); }
// A task that throws, and one whose owner is no Owner.
const thrower = build("thrower", 30);
thrower.blocks[2].task.step = () => { throw new RangeError("step"); };
try { out.push(thrower.run(500)); } catch (error) { out.push(error.name + " " + error.message); }
tell("thrower", thrower);
const other = build("other", 40);
other.blocks[0].task.owner = { release: id => (id == 1 ? other.current : null), hold: () => null };
out.push(other.run(300)); tell("other", other);
try { const none = build("none", 10); none.blocks[0].task.owner = null; out.push(none.run(50)); } catch (error) { out.push(error.name); }
for (const line of out) console.log(line);
