-- The tables of the backend benchmark. Run it as the owner of an empty database: psql -f schema.sql
--
-- world and fortune have the schema and the size that the TechEmpower Framework Benchmarks ask for.
-- customer, session and product belong to the shop (app/shop). Every row of theirs is computed from its id, so that
-- answers.ts can say what the shop must answer without asking the database.

DROP TABLE IF EXISTS world, fortune, session, customer, product;

CREATE TABLE world (
  id integer NOT NULL PRIMARY KEY,
  randomnumber integer NOT NULL DEFAULT 0
);

INSERT INTO world (id, randomnumber)
SELECT n, least(floor(random() * 10000 + 1), 10000) FROM generate_series(1, 10000) AS n;

CREATE TABLE fortune (
  id integer NOT NULL PRIMARY KEY,
  message varchar(2048) NOT NULL
);

INSERT INTO fortune (id, message) VALUES
  (1, 'fortune: No such file or directory'),
  (2, 'A computer scientist is someone who fixes things that aren''t broken.'),
  (3, 'After enough decimal places, nobody gives a damn.'),
  (4, 'A bad random number generator: 1, 1, 1, 1, 1, 4.33e+67, 1, 1, 1'),
  (5, 'A computer program does what you tell it to do, not what you want it to do.'),
  (6, 'Emacs is a nice operating system, but I prefer UNIX. — Tom Christaensen'),
  (7, 'Any program that runs right is obsolete.'),
  (8, 'A list is only as strong as its weakest link. — Donald Knuth'),
  (9, 'Feature: A bug with seniority.'),
  (10, 'Computers make very fast, very accurate mistakes.'),
  (11, '<script>alert("This should not be displayed in a browser alert box.");</script>'),
  (12, 'フレームワークのベンチマーク');

CREATE TABLE customer (
  id integer NOT NULL PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  tier text NOT NULL,
  country text NOT NULL,
  orders_placed integer NOT NULL
);

INSERT INTO customer (id, name, email, tier, country, orders_placed)
SELECT n,
       'Customer ' || n,
       'customer' || n || '@example.com',
       (ARRAY['standard', 'silver', 'gold'])[n % 3 + 1],
       (ARRAY['PT', 'JP', 'US', 'KE', 'NO'])[n % 5 + 1],
       n * 7 % 40
FROM generate_series(1, 1000) AS n;

CREATE TABLE session (
  token text NOT NULL PRIMARY KEY,
  customer_id integer NOT NULL REFERENCES customer (id),
  expires_at timestamptz NOT NULL
);

INSERT INTO session (token, customer_id, expires_at)
SELECT 'session-' || lpad(n::text, 4, '0') || '-' || md5('session ' || n),
       n,
       CASE WHEN n % 100 = 0 THEN timestamptz '2001-01-01 00:00:00+00' ELSE timestamptz '2999-01-01 00:00:00+00' END
FROM generate_series(1, 1000) AS n;

CREATE TABLE product (
  id integer NOT NULL PRIMARY KEY,
  shop text NOT NULL,
  sku text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  price_cents integer NOT NULL,
  weight_grams integer NOT NULL,
  stock integer NOT NULL
);

INSERT INTO product (id, shop, sku, name, description, price_cents, weight_grams, stock)
SELECT n,
       (ARRAY['west', 'east'])[n % 2 + 1],
       'SKU-' || lpad(n::text, 5, '0'),
       (ARRAY['Kettle', 'Lamp', 'Notebook', 'Backpack', 'Teapot', 'Blanket', 'Speaker'])[n % 7 + 1] || ' No. ' || n,
       'Item ' || n || ' of the catalog. Made to order, checked by hand, and shipped in a box that can be used again.',
       199 + n * 37 % 9800,
       80 + n * 13 % 2400,
       n * 11 % 60
FROM generate_series(1, 2000) AS n;

CREATE INDEX product_shop ON product (shop, id);

ANALYZE world, fortune, customer, session, product;
