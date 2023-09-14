// Represents the schema of the protocol.json file.

export type Protocol = {
  readonly name: string;
  readonly version: {
    readonly major: number;
    readonly minor: number;
  };
  readonly domains: readonly Domain[];
};

export type Domain = {
  readonly domain: string;
  readonly dependencies?: readonly string[];
  readonly types: readonly Property[];
  readonly commands?: readonly Command[];
  readonly events?: readonly Event[];
};

export type Command = {
  readonly name: string;
  readonly description?: string;
  readonly parameters?: readonly Property[];
  readonly returns?: readonly Property[];
};

export type Event = {
  readonly name: string;
  readonly description?: string;
  readonly parameters: readonly Property[];
};

export type Property = {
  readonly id?: string;
  readonly name?: string;
  readonly description?: string;
  readonly optional?: boolean;
} & (
  | {
      readonly type: "array";
      readonly items?: Property;
    }
  | {
      readonly type: "object";
      readonly properties?: readonly Property[];
    }
  | {
      readonly type: "string";
      readonly enum?: readonly string[];
    }
  | {
      readonly type: "boolean" | "number" | "integer";
    }
  | {
      readonly type: undefined;
      readonly $ref: string;
    }
);
