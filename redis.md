# Redis Commands Implementation Progress

## Core String Operations (11 commands)

- [x] GETRANGE
- [x] SETRANGE
- [x] SETEX
- [x] PSETEX
- [x] GETBIT
- [x] SETBIT
- [x] INCRBY
- [x] INCRBYFLOAT
- [x] DECRBY
- [x] MSET
- [x] MSETNX

## List Operations (15 commands)

- [x] LRANGE
- [x] LINDEX
- [x] LSET
- [x] LINSERT
- [x] LREM
- [x] LTRIM
- [x] RPOPLPUSH
- [x] LPOS
- [x] LMOVE
- [x] BLPOP
- [x] BRPOP
- [x] BLMOVE
- [x] BRPOPLPUSH
- [x] LMPOP
- [x] BLMPOP

## Set Operations (9 commands)

- [x] SINTER
- [x] SINTERSTORE
- [x] SINTERCARD
- [x] SUNION
- [x] SUNIONSTORE
- [x] SDIFF
- [x] SDIFFSTORE
- [x] SMISMEMBER
- [x] SSCAN

## Sorted Set Operations (28 commands)

### Tier 1 - Simple (6 commands)
- [x] ZINCRBY
- [x] ZCOUNT
- [x] ZLEXCOUNT
- [x] ZREMRANGEBYRANK
- [x] ZREMRANGEBYSCORE
- [x] ZREMRANGEBYLEX

### Tier 2 - Simple Variadic (2 commands)
- [x] ZREM
- [x] ZMSCORE

### Tier 3 - Complex Options (9 commands)
- [x] ZADD
- [x] ZRANGE
- [x] ZREVRANGE
- [x] ZRANGEBYSCORE
- [x] ZREVRANGEBYSCORE
- [x] ZRANGEBYLEX
- [x] ZREVRANGEBYLEX
- [x] ZRANGESTORE
- [x] ZSCAN

### Tier 4 - Set Operations (7 commands)
- [x] ZINTER
- [x] ZINTERSTORE
- [x] ZINTERCARD
- [x] ZDIFF
- [x] ZDIFFSTORE
- [x] ZUNION
- [x] ZUNIONSTORE

### Tier 5 - Blocking (4 commands)
- [x] BZPOPMIN
- [x] BZPOPMAX
- [x] ZMPOP
- [x] BZMPOP

## Hash Operations (18 commands)

### Tier 1 - Ergonomic Set Operations (2 commands)
- [ ] HSET (supports Map/Record OR variadic field/value pairs)
- [ ] HSETNX

### Tier 2 - Basic Operations (4 commands)
- [ ] HDEL
- [ ] HEXISTS
- [ ] HRANDFIELD
- [ ] HSCAN

### Tier 3 - Get/Set with Options (3 commands)
- [ ] HGETDEL
- [ ] HGETEX
- [ ] HSETEX

### Tier 4 - Field Expiration (9 commands)
- [ ] HEXPIRE
- [ ] HEXPIREAT
- [ ] HEXPIRETIME
- [ ] HPERSIST
- [ ] HPEXPIRE
- [ ] HPEXPIREAT
- [ ] HPEXPIRETIME
- [ ] HPTTL
- [ ] HTTL

## Key Management (8 commands)

- [x] RENAME
- [x] RENAMENX
- [x] COPY
- [x] UNLINK
- [x] TYPE
- [x] TOUCH
- [x] RANDOMKEY
- [x] SCAN

## Key Expiration & TTL (3 commands)

- [x] EXPIREAT
- [x] PEXPIRE
- [x] PEXPIREAT

---

**Total: 92 commands**