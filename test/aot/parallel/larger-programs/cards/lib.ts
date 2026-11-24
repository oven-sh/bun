// Cards: decks that are shuffled by seed, poker hands that are ranked and compared, a game of trick taking with players that choose, statistics
export enum Suit {
  Clubs, Diamonds, Hearts, Spades
}
export enum HandRank {
  High, Pair, TwoPairs, Three, Straight, Flush, FullHouse, Four, StraightFlush
}
export class Random {
  #state: number;
  constructor(seed: number) {
    this.#state = seed >>> 0 || 1;
  }
  next(): number {
    let x = this.#state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.#state = x >>> 0;
    return this.#state / 4294967296;
  }
  int(n: number) {
    return Math.floor(this.next() * n);
  }
  pick<T>(list: readonly T[]): T {
    return list[this.int(list.length)];
  }
  shuffle<T>(list: T[]): T[] {
    for (let i = list.length - 1; i > 0; i--) {
      const k = this.int(i + 1);
      [list[i], list[k]] = [list[k], list[i]];
    }
    return list;
  }
}
export class Card {
  private constructor(readonly rank: number, readonly suit: Suit) {
  }
  static readonly all: readonly Card[] = Array.from({ length: 52 }, (_,
    i) => new Card(2 + (i % 13), Math.floor(i / 13)));
  static of(text: string): Card {
    const rank = "23456789TJQKA".indexOf(text[0]) + 2, suit = "cdhs".indexOf(text[1]);
    const card = Card.all.find(c => c.rank === rank && c.suit === suit);
    if (!card) throw new RangeError("no card " + text);
    return card;
  }
  get symbol() {
    return "23456789TJQKA"[this.rank - 2] + "cdhs"[this.suit];
  }
  toString() {
    return this.symbol;
  }
  static compare(a: Card, b: Card) {
    return b.rank - a.rank || b.suit - a.suit;
  }
}
export class Deck {
  readonly #cards: Card[];
  constructor(readonly random: Random, filter: (c: Card) => boolean = () => true) {
    this.#cards = random.shuffle(Card.all.filter(filter));
  }
  get left() {
    return this.#cards.length;
  }
  deal(n: number): Card[] {
    if (n > this.#cards.length) throw new RangeError(`only ${this.#cards.length} cards`);
    return this.#cards.splice(-n);
  }
}
export class Hand implements Iterable<Card> {
  readonly cards: readonly Card[];
  readonly rank: HandRank;
  readonly order: readonly number[];
  static evaluated = 0;
  constructor(cards: readonly Card[]) {
    if (cards.length !== 5) throw new RangeError("five cards");
    Hand.evaluated++;
    this.cards = [...cards].sort(Card.compare);
    const counts = new Map<number, number>();
    for (const c of this.cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
    const groups = [...counts].sort(([a, n], [b, m]) => m - n || b - a);
    const flush = this.cards.every(c => c.suit === this.cards[0].suit);
    const ranks = this.cards.map(c => c.rank);
    let straight = groups.length === 5 && ranks[0] - ranks[4] === 4;
    let order = groups.map(([r]) => r);
    if (groups.length === 5 && ranks[0] === 14 && ranks[1] === 5) {
      straight = true;
      order = [5, 4, 3, 2, 1];
    }
    this.order = order;
    const [first, second] = groups.map(([, n]) => n);
    this.rank = straight &&
      flush ? HandRank.StraightFlush : first === 4 ? HandRank.Four : first === 3 &&
      second === 2 ? HandRank.FullHouse : flush ? HandRank.Flush : straight ? HandRank.Straight : first === 3 ? HandRank.Three : first === 2 &&
      second === 2 ? HandRank.TwoPairs : first === 2 ? HandRank.Pair : HandRank.High;
  }
  *[Symbol.iterator]() {
    yield* this.cards;
  }
  compare(other: Hand): number {
    if (this.rank !== other.rank) return this.rank - other.rank;
    for (let i = 0; i < this.order.length; i++) if (this.order[i] !== other.order[i]) return this.order[i] - other.order[i];
    return 0;
  }
  toString() {
    return `${this.cards.join(" ")} (${HandRank[this.rank]})`;
  }
  static best(cards: readonly Card[]): Hand {
    let best: Hand | null = null;
    for (const five of choose(cards, 5)) {
      const h = new Hand(five);
      if (!best || h.compare(best) > 0) best = h;
    }
    return best!;
  }
}
export function* choose<T>(list: readonly T[], n: number, from = 0): Generator<T[]> {
  if (n === 0) {
    yield [];
    return;
  }
  for (let i = from; i <= list.length - n; i++) for (const rest of choose(list, n - 1,
    i + 1)) yield [list[i], ...rest];
}
export interface Play {
  player: Player;
  card: Card
}
export interface View {
  readonly trick: readonly Play[];
  readonly trump: Suit | null;
  readonly played: ReadonlySet<Card>;
  legal: readonly Card[]
}
export abstract class Player {
  readonly hand: Card[] = [];
  tricks = 0;
  points = 0;
  bid = 0;
  constructor(readonly name: string) {
  }
  take(cards: Card[]) {
    this.hand.length = 0;
    this.hand.push(...cards.sort(Card.compare));
    this.tricks = 0;
  }
  abstract choose(v: View): Card;
  guess(trump: Suit | null): number {
    return this.hand.filter(c => c.rank >= 13 || c.suit === trump && c.rank >= 11).length;
  }
  play(v: View): Card {
    const c = this.choose(v);
    if (!v.legal.includes(c)) throw new TypeError(`${this.name} played ${c}`);
    this.hand.splice(this.hand.indexOf(c), 1);
    return c;
  }
}
export class LowPlayer extends Player {
  choose(v: View) {
    return v.legal.reduce((a, b) => (b.rank < a.rank ? b : a));
  }
  guess() {
    return 0;
  }
}
export class HighPlayer extends Player {
  choose(v: View) {
    return v.legal.reduce((a, b) => (b.rank > a.rank ? b : a));
  }
}
export class RandomPlayer extends Player {
  constructor(name: string, readonly random: Random) {
    super(name);
  }
  choose(v: View) {
    return this.random.pick(v.legal);
  }
}
export class ThinkingPlayer extends Player {
  #seen = 0;
  choose(v: View): Card {
    this.#seen += v.played.size;
    const want = this.tricks < this.bid;
    const best = v.trick.length ? Game.winner(v.trick, v.trump).card : null;
    const beats = best ? v.legal.filter(c => Game.beats(c, best, v.trump)) : v.legal;
    if (want && beats.length) {
      const sure = beats.filter(c => !Card.all.some(o => o.suit === c.suit &&
        o.rank > c.rank && !v.played.has(o) && !this.hand.includes(o)));
      return (sure.length ? sure : beats).reduce((a,
        b) => (v.trick.length === 3 ? b.rank < a.rank : b.rank > a.rank) ? b : a);
    }
    const loses = v.legal.filter(c => !beats.includes(c));
    return (loses.length ? loses : v.legal).reduce((a,
      b) => (want ? b.rank < a.rank : b.rank > a.rank &&
      loses.length > 0 ? true : b.rank < a.rank) ? b : a);
  }
  get seen() {
    return this.#seen;
  }
}
export class Game {
  rounds = 0;
  readonly log: string[] = [];
  constructor(readonly players: Player[], readonly random: Random) {
    if (players.length < 2) throw new RangeError("two players");
  }
  static beats(a: Card, b: Card, trump: Suit | null) {
    return a.suit === b.suit ? a.rank > b.rank : a.suit === trump;
  }
  static winner(trick: readonly Play[], trump: Suit | null): Play {
    return trick.reduce((best, p) => (Game.beats(p.card, best.card, trump) ? p : best));
  }
  round(cards: number): void {
    const deck = new Deck(this.random);
    for (const p of this.players) p.take(deck.deal(cards));
    const trump = deck.left ? deck.deal(1)[0].suit : null;
    for (const p of this.players) p.bid = p.guess(trump);
    let leader = this.rounds % this.players.length;
    const played = new Set<Card>();
    for (let t = 0; t < cards; t++) {
      const trick: Play[] = [];
      for (let i = 0; i < this.players.length; i++) {
        const player = this.players[(leader + i) % this.players.length];
        const lead = trick[0]?.card.suit;
        const follow = lead === undefined ? [] : player.hand.filter(c => c.suit === lead);
        const card = player.play({ trick, trump, played,
          legal: follow.length ? follow : [...player.hand] });
        trick.push({ player, card });
      }
      for (const { card } of trick) played.add(card);
      const w = Game.winner(trick, trump);
      w.player.tricks++;
      leader = this.players.indexOf(w.player);
      if (this.rounds === 0 &&
        t < 2) this.log.push(trick.map(p => p.player.name + ":" + p.card).join(" ") + " > " + w.player.name);
    }
    for (const p of this.players) p.points += p.tricks === p.bid ? 10 + p.bid : -Math.abs(p.tricks - p.bid);
    this.rounds++;
  }
}
export namespace Stats {
  export function hands(random: Random, n: number): Record<string, number> {
    const out: Record<string, number> = {
  };
    for (let i = 0; i < n; i++) {
      const name = HandRank[new Hand(new Deck(random).deal(5)).rank];
      out[name] = (out[name] ?? 0) + 1;
    }
    return out;
  }
  export function duel(random: Random, n: number) {
    let a = 0, b = 0, even = 0;
    let top: Hand | null = null;
    for (let i = 0; i < n; i++) {
      const deck = new Deck(random), table = deck.deal(5);
      const x = Hand.best([...table, ...deck.deal(2)]), y = Hand.best([...table,
        ...deck.deal(2)]);
      const d = x.compare(y);
      if (d > 0) a++;
      else if (d < 0) b++;
      else even++;
      if (!top || x.compare(top) > 0) top = x;
    }
    return {
      a, b, even, top: String(top)
  };
  }
}
