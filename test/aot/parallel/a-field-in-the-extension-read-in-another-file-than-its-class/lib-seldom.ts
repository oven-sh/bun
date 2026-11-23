export class Seldom {
    before: number = 1;
    beside: number = 2;
    count?: number;
    early?: Seldom;
    wanted?: Seldom;
    late?: Seldom;
    constructor(count: number, fills: boolean) { if (fills) { this.count = count | 0; this.wanted = this; } else if (count & 1) this.early = this; else this.late = this; }
}
export class Rarely {
    before: number = 5;
    beside: number = 6;
    third: number = 7;
    wanted?: Rarely;
    constructor(fills: boolean) { if (fills) this.wanted = this; }
}
