export class UserA { id: number = 0; name: string = "made"; }
export function one(u: UserA): string { return u.name + u.id + " " + (u instanceof UserA); }
export default function byDefault(u: UserA): string { return one(u); }
export class Taker { kept: UserA; constructor(u: UserA) { this.kept = u; } show(): string { return one(this.kept); } }
export function own(): string { return one(new UserA()); }
