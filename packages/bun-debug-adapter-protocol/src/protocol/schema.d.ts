export type Protocol = {
  $schema: string;
  title: string;
  description: string;
  type: "object";
  definitions: Record<string, Type>;
};

export type Type = {
  description?: string;
} & (
  | {
      type: "number" | "integer" | "boolean";
    }
  | {
      type: "string";
      enum?: string[];
      enumDescriptions?: string[];
    }
  | {
      type: "object";
      properties?: Record<string, Type>;
      required?: string[];
    }
  | {
      type: "array";
      items?: Type;
    }
  | {
      type?: undefined;
      $ref: string;
    }
  | {
      type?: undefined;
      allOf: Type[];
    }
);
