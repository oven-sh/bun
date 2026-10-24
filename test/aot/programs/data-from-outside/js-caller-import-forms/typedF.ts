export class UserF { id: number = 0; name: string = "made"; }
export function one(u: UserF): string { return u.name + u.id + " " + (u instanceof UserF); }
export default function byDefault(u: UserF): string { return one(u); }
export class Taker { kept: UserF; constructor(u: UserF) { this.kept = u; } show(): string { return one(this.kept); } }
export function own(): string { return one(new UserF()); }
