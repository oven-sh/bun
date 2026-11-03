interface Animal { species: string; legs: number }
interface Dog extends Animal { bark(): string; tricks: string[] }
interface Cat extends Animal { meow(): string; lives?: number }
function dog(n: number): Dog { return { species: "dog" + n, legs: 4, bark() { return "woof " + this.species }, tricks: ["sit"] } }
function cat(n: number): Cat { return { meow() { return "meow " + this.species }, species: "cat" + n, legs: 4, lives: 9 - n } }

const dogs: Dog[] = [dog(0), dog(1)]
const animals: Animal[] = dogs
animals.push(cat(0))
animals[0] = cat(1)
console.log(dogs.length, dogs === animals, animals.map(a => a.species + a.legs).join())
for (const a of animals) console.log(a.species, a.legs + 1, "bark" in a, Object.keys(a).join())
console.log(dogs[1].bark(), dogs[1].tricks.length, (animals[2] as Cat).meow(), (animals[2] as Cat).lives, JSON.stringify(animals[2]))

// Classes.
class Pet { constructor(public tagName: string) {} speak(): string { return "..." } describe(): string { return this.tagName + " says " + this.speak() } }
class Hound extends Pet { nose = 10; speak() { return "woof" } sniff() { return this.nose * 2 } }
class Tabby extends Pet { claws = 18; speak() { return "meow" } scratch() { return this.claws + 1 } }
const hounds: Hound[] = [new Hound("h0")]
const pets: Pet[] = hounds
pets.push(new Tabby("t0"), new Pet("p0"), new Hound("h1"))
console.log(pets.map(p => p.describe()).join(), pets.map(p => p instanceof Hound ? p.sniff() : p instanceof Tabby ? p.scratch() : "-").join(), pets.map(p => "nose" in p).join(), hounds.length, hounds[0].sniff(), hounds[3].describe())

// Through a generic function, a readonly view and a method of the array.
function append<T>(list: T[], item: T): T[] { list.push(item); return list }
const kennel: Dog[] = [dog(5)]
append<Animal>(kennel, { species: "fish", legs: 0 })
const fixed: readonly Animal[] = kennel
console.log(fixed.map(a => a.species).join(), kennel[0].bark(), fixed.map(a => a.legs).join())
const sorted: Animal[] = kennel
sorted.sort((x, y) => x.legs - y.legs)
sorted.unshift(cat(3))
console.log(sorted.map(a => a.species + ":" + ("bark" in a)).join(), kennel.length, kennel[2].bark())

// Arrays of arrays, and arrays in fields.
interface Pack { members: Dog[]; leader?: Dog }
interface Herd { members: Animal[]; leader?: Animal }
const pack: Pack = { members: [dog(7)] }
const herd: Herd = pack
herd.members.push(cat(7))
herd.leader = cat(8)
console.log(pack.members.length, pack.members[0].bark(), herd.members.map(m => m.species).join(), herd.leader?.species, herd.leader?.legs, "leader" in pack)
herd.members = [cat(9)]
console.log(pack.members.length, herd.members[0].species, pack.members === herd.members)
const grid: Dog[][] = [[dog(1)], []]
const anyGrid: Animal[][] = grid
anyGrid[1].push(cat(2)); anyGrid.push([cat(3)])
console.log(anyGrid.map(row => row.map(a => a.species).join("+")).join("/"), grid.length, grid[0][0].bark())

// Maps, sets and tuples carry the same confusion.
const byName = new Map<string, Dog>([["a", dog(1)]])
const wider: Map<string, Animal> = byName
wider.set("b", cat(1))
const pair: [Dog, Dog] = [dog(2), dog(3)]
const widerPair: [Animal, Animal] = pair
widerPair[1] = cat(4)
console.log([...wider.values()].map(a => a.species).join(), byName.get("a")?.bark(), wider.get("b")?.species, byName.size, pair[0].bark(), widerPair.map(a => a.species).join())
