export class User { id: number = 0; name: string = "made"; }
function show(u: User): string { return u.name + u.id + " " + (u instanceof User) + " " + Object.keys(u).join(); }
export function one(u: User): string { return show(u); }
export function many(users: User[]): string { return users.map(show).join(" | "); }
export function keyed(users: Map<string, User>): string { return show(users.get("k")!); }
export function held(holder: { inner: User }): string { return show(holder.inner); }
export class Service { last: User = new User(); take(u: User): string { this.last = u; return show(this.last); } all(users: User[]): string { return many(users); } }
export const arrow = (u: User): string => show(u);
export function own(): string { return show(new User()); }
