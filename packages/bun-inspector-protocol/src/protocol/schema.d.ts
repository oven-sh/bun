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
  readonly description?: string;
  readonly debuggableTypes?: readonly string[];
  readonly dependencies?: readonly string[];
  readonly types?: readonly Property[];
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
  readonly parameters?: readonly Property[];
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
      /**
       * A type of the same domain (`RemoteObject`), of another domain (`Network.RequestId`), or one of
       * the primitives in `primitiveTypes` of scripts/generate-protocol.ts (`boolean`).
       */
      readonly $ref: string;
    }
);
