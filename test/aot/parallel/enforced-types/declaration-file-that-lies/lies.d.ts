export declare class Owner {
  name: string;
}
export declare class Thing {
  size: number;
  owner: Owner;
  constructor(seed: number);
}
export declare function makeThing(seed: number): Thing;
