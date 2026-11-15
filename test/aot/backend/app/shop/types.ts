export type Tier = "standard" | "silver" | "gold";

export type Country = "PT" | "JP" | "US" | "KE" | "NO";

export interface Session {
  token: string;
  customerId: number;
  expiresAt: Date;
}

export interface Customer {
  id: number;
  name: string;
  email: string;
  tier: Tier;
  country: Country;
  ordersPlaced: number;
}

export interface Product {
  id: number;
  shop: string;
  sku: string;
  name: string;
  description: string;
  priceCents: number;
  weightGrams: number;
  stock: number;
}

export interface Rate {
  service: string;
  cents: number;
  days: number;
}

export interface Address {
  name: string;
  street: string;
  city: string;
  postalCode: string;
  country: Country;
}

export interface Line {
  productId: number;
  sku: string;
  name: string;
  description: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
  weightGrams: number;
  inStock: boolean;
  note: string | null;
}

export interface Quote {
  shop: string;
  customer: { id: number; name: string; email: string; tier: Tier; returning: boolean };
  shipTo: Address;
  lines: Line[];
  shipping: { chosen: Rate; options: Rate[]; weightGrams: number };
  totals: {
    subtotalCents: number;
    discountPercent: number;
    discountCents: number;
    giftWrapCents: number;
    shippingCents: number;
    taxPercent: number;
    taxCents: number;
    totalCents: number;
  };
  currency: string;
}
