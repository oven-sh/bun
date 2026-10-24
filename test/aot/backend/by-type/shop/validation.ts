import type { Schema } from "bun";
import type { Country } from "./types";

type Text<Longest extends number> = string & Schema.MinLength<1> & Schema.MaxLength<Longest>;

interface Item {
  productId: number & Schema.Int & Schema.Min<1>;
  quantity: number & Schema.Int & Schema.Min<1> & Schema.Max<99>;
  note?: string & Schema.MaxLength<200>;
}

export interface Order {
  items: Item[] & Schema.MinItems<1> & Schema.MaxItems<20>;
  shipTo: {
    name: Text<100>;
    street: Text<200>;
    city: Text<100>;
    postalCode: Text<16>;
    country: Country;
  };
  coupon?: string & Schema.MaxLength<20>;
  giftWrap: boolean;
}

export async function readOrder(request: Request): Promise<Order | undefined> {
  try {
    return JSON.parse<Order & Schema.DeepStrict>(await request.text());
  } catch {
    return undefined;
  }
}
