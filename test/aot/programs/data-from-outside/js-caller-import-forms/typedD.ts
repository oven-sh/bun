export class UserD { id: number = 0; name: string = "made"; }
export function one(u: UserD): string { return u.name + u.id + " " + (u instanceof UserD); }
export default function byDefault(u: UserD): string { return one(u); }
export class Taker { kept: UserD; constructor(u: UserD) { this.kept = u; } show(): string { return one(this.kept); } }
export function own(): string { return one(new UserD()); }
