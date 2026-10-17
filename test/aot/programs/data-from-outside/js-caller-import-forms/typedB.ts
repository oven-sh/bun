export class UserB { id: number = 0; name: string = "made"; }
export function one(u: UserB): string { return u.name + u.id + " " + (u instanceof UserB); }
export default function byDefault(u: UserB): string { return one(u); }
export class Taker { kept: UserB; constructor(u: UserB) { this.kept = u; } show(): string { return one(this.kept); } }
export function own(): string { return one(new UserB()); }
