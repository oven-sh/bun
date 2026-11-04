// a loop over what a generator method gives, called on an object that is read out of a field, so that its class is only written: the arms of the guess meet between the call and the loop
class Shelf { books: number[]; constructor(books: number[]) { this.books = books; } *titles() { for (let i = 0; i < this.books.length; i++) yield this.books[i] * 2; } }
class Crate { *titles() { yield 7; yield 8; } }
class Room { shelf: Shelf; constructor(shelf: Shelf) { this.shelf = shelf; } }
function total(room: Room) { let sum = 0; for (const title of room.shelf.titles()) sum += title; return sum; }
function totalOfAll(rooms: Room[]) { let sum = 0; for (let i = 0; i < rooms.length; i++) { for (const title of rooms[i].shelf.titles()) { if (title > 100) break; sum += title; } } return sum; }
const rooms = [new Room(new Shelf([1, 2, 3])), new Room(new Shelf([])), new Room(new Shelf([4]))];
console.log(String(total(rooms[0])));
for (let i = 0; i < 3; i++) console.log(String(total(rooms[i])));
console.log(String(totalOfAll(rooms)));
rooms.push(new Room(new Crate() as any));
console.log(String(total(rooms[3])));
console.log(String(totalOfAll(rooms)));
console.log(String(total(rooms[0])));
