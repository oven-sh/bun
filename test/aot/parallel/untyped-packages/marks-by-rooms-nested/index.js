// one expression for each room, its alternatives told apart by the group that matched; rooms that lie on one another; rows and places counted
'use strict';
const plain = words => Array.from(words, c => (/[\w\s]/.test(c) ? c : '\\' + c)).join('');
class Reader {
  constructor(rooms) {
    this.rooms = new Map();
    for (const [room, kinds] of Object.entries(rooms)) {
      const ways = [];
      for (const kind in kinds) ways.push({ like: kinds[kind].like || kinds[kind], kind, turn: kinds[kind].turn, down: kinds[kind].down, over: kinds[kind].over, up: kinds[kind].up });
      const any = ways.map(way => '(' + (typeof way.like === 'string' ? plain(way.like) : way.like.source) + ')');
      this.rooms.set(room, { ways, any: new RegExp(any.join('|'), 'my') });
    }
    this.begin('');
  }
  begin(words) {
    this.room = this.rooms.keys().next().value;
    this.below = [];
    this.words = words;
    this.row = this.place = 1;
    this.at = 0;
    return this;
  }
  step() {
    const room = this.rooms.get(this.room);
    if (this.at === this.words.length) return null;
    if (!room) throw new Error('above the first room');
    room.any.lastIndex = this.at;
    const hit = room.any.exec(this.words);
    if (hit === null) throw new Error('nothing of ' + this.room + ' is like ' + JSON.stringify(this.words.substr(this.at, 5)) + ', row ' + this.row + ', place ' + this.place);
    let group = 1;
    while (hit[group] === undefined) group++;
    const way = room.ways[group - 1], whole = hit[0], mark = { row: this.row, place: this.place, what: way.turn ? way.turn(whole) : whole, kind: way.kind };
    const rows = whole.split('\n');
    this.row += rows.length - 1;
    if (rows.length > 1) this.place = 1;
    this.place += rows.pop().length;
    this.at += whole.length;
    if (way.up) this.room = this.below.pop();
    if (way.down) { this.below.push(this.room); this.room = way.down; }
    if (way.over) this.room = way.over;
    return mark;
  }
  each(f) { for (let mark = this.step(); mark; mark = this.step()) f(mark); return this; }
}
module.exports = { read: rooms => new Reader(rooms) };
