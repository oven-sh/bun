// @ts-nocheck
// The content of this file is included in each generated protocol file.

export type Event<T extends keyof EventMap = keyof EventMap> = {
  readonly method: T;
  readonly params: EventMap[T];
};

export type Request<T extends keyof RequestMap = keyof RequestMap> = {
  readonly id: number;
  readonly method: T;
  readonly params: RequestMap[T];
};

export type Response<T extends keyof ResponseMap = keyof ResponseMap> = {
  readonly id: number;
} & (
  | {
      readonly method?: T;
      readonly result: ResponseMap[T];
    }
  | {
      readonly error: {
        readonly code?: string;
        readonly message: string;
      };
    }
);
