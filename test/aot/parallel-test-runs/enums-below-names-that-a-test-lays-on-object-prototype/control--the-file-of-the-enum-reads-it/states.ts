export enum State { Ready = 3, Done = 4 }
export function read() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return State.Ready; }
