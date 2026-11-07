// The other service: the shop asks it over HTTP what it costs to ship a parcel.
const baseCents: Record<string, number> = { PT: 390, JP: 1290, US: 990, KE: 1490, NO: 690 };

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.PORT ?? 3001),
  reusePort: true,
  idleTimeout: 0,
  routes: {
    "/rates": request => {
      const query = new URL(request.url).searchParams;
      const country = query.get("country") ?? "";
      const grams = Number(query.get("grams"));
      const base = baseCents[country];
      if (base === undefined || !Number.isInteger(grams) || grams < 1) return Response.json({ error: "invalid parcel" }, { status: 400 });
      const steps = Math.floor(grams / 100);
      return Response.json({
        carrier: "Northwind Freight",
        currency: "EUR",
        country,
        grams,
        rates: [
          { service: "express", cents: base * 3 + steps * 35, days: 2 },
          { service: "standard", cents: Math.floor((base * 3) / 2) + steps * 18, days: 5 },
          { service: "economy", cents: base + steps * 12, days: 9 },
        ],
      });
    },
  },
  fetch() {
    return new Response("Not Found", { status: 404 });
  },
});

console.log("listening", server.port);
