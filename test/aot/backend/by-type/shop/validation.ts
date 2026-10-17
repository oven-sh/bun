import type { Int, Max, MaxItems, MaxLength, Min, MinItems, MinLength, DeepStrict } from "bun";
import type { Country } from "./types";

type Text<Longest extends number> = string & MinLength<1> & MaxLength<Longest>;

interface Item {
  productId: number & Int & Min<1>;
  quantity: number & Int & Min<1> & Max<99>;
  note?: string & MaxLength<200>;
}

export interface Order {
  items: Item[] & MinItems<1> & MaxItems<20>;
  shipTo: {
    name: Text<100>;
    street: Text<200>;
    city: Text<100>;
    postalCode: Text<16>;
    country: Country;
  };
  coupon?: string & MaxLength<20>;
  giftWrap: boolean;
}

export function parseOrder(body: unknown): Order | undefined {
  const result = Bun.safeValidate<Order & DeepStrict>(body);
  return result.success ? result.data : undefined;
}
