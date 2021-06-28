// This is the hash map implementation built in to zig
// except, with a getWithHash(key: K)
// and a hash getWithHash(key: K)

const std = @import("std");
const assert = debug.assert;
const autoHash = std.hash.autoHash;
const debug = std.debug;
const warn = debug.warn;
const math = std.math;
const mem = std.mem;
const meta = std.meta;
const trait = meta.trait;
const Allocator = mem.Allocator;
const Wyhash = @import("./Wyhash.zig").Wyhash;

pub fn getAutoHashFn(comptime K: type) (fn (K) u64) {
    comptime {
        assert(@hasDecl(std, "StringHashMap")); // detect when the following message needs updated
        if (K == []const u8) {
            @compileError("std.auto_hash.autoHash does not allow slices here (" ++
                @typeName(K) ++
                ") because the intent is unclear. " ++
                "Consider using std.StringHashMap for hashing the contents of []const u8. " ++
                "Alternatively, consider using std.auto_hash.hash or providing your own hash function instead.");
        }
    }

    return struct {
        fn hash(key: K) u64 {
            if (comptime trait.hasUniqueRepresentation(K)) {
                return Wyhash.hash(0, std.mem.asBytes(&key));
            } else {
                var hasher = Wyhash.init(0);
                autoHash(&hasher, key);
                return hasher.final();
            }
        }
    }.hash;
}

const autoEqlTrait = std.meta.trait.hasFn("eql");
pub fn getAutoEqlFn(comptime K: type) (fn (K, K) bool) {
    if (comptime autoEqlTrait(K)) {
        return @field(K, "eql");
    }

    return struct {
        fn eql(a: K, b: K) bool {
            return meta.eql(a, b);
        }
    }.eql;
}

pub fn AutoHashMap(comptime K: type, comptime V: type) type {
    return HashMap(K, V, getAutoHashFn(K), getAutoEqlFn(K), default_max_load_percentage);
}

pub fn AutoHashMapUnmanaged(comptime K: type, comptime V: type) type {
    return HashMapUnmanaged(K, V, getAutoHashFn(K), getAutoEqlFn(K), default_max_load_percentage);
}

/// Builtin hashmap for strings as keys.
pub fn StringHashMap(comptime V: type) type {
    return HashMap([]const u8, V, hashString, eqlString, default_max_load_percentage);
}

pub fn StringHashMapUnmanaged(comptime V: type) type {
    return HashMapUnmanaged([]const u8, V, hashString, eqlString, default_max_load_percentage);
}

// ❯ hyperfine "./esdev.stringEqlNoPtrCheck --resolve=dev --cwd /Users/jarred/Code/esdev/bench/rome/src entry --platform=node --outdir=/Users/jarred/Code/esdev/bench/rome/src/out --public-url=https://hello.com/" "./esdev-fd-rel-hash --resolve=dev --cwd /Users/jarred/Code/esdev/bench/rome/src entry --platform=node --outdir=/Users/jarred/Code/esdev/bench/rome/src/out --public-url=https://hello.com/" --min-runs=50
// Benchmark #1: ./esdev.stringEqlNoPtrCheck --resolve=dev --cwd /Users/jarred/Code/esdev/bench/rome/src entry --platform=node --outdir=/Users/jarred/Code/esdev/bench/rome/src/out --public-url=https://hello.com/
//   Time (mean ± σ):     251.5 ms ±   7.8 ms    [User: 110.0 ms, System: 135.7 ms]
//   Range (min … max):   239.0 ms … 281.1 ms    50 runs

// Benchmark #2: ./esdev-fd-rel-hash --resolve=dev --cwd /Users/jarred/Code/esdev/bench/rome/src entry --platform=node --outdir=/Users/jarred/Code/esdev/bench/rome/src/out --public-url=https://hello.com/
//   Time (mean ± σ):     249.3 ms ±   8.3 ms    [User: 110.8 ms, System: 134.0 ms]
//   Range (min … max):   239.8 ms … 288.7 ms    50 runs

// Summary
//   './esdev-fd-rel-hash --resolve=dev --cwd /Users/jarred/Code/esdev/bench/rome/src entry --platform=node --outdir=/Users/jarred/Code/esdev/bench/rome/src/out --public-url=https://hello.com/' ran
//     1.01 ± 0.05 times faster than './esdev.stringEqlNoPtrCheck --resolve=dev --cwd /Users/jarred/Code/esdev/bench/rome/src entry --platform=node --outdir=/Users/jarred/Code/esdev/bench/rome/src/out --public-url=https://hello.com/'
pub fn eqlString(a: []const u8, b: []const u8) bool {
    return mem.eql(u8, a, b);
}

pub fn hashString(s: []const u8) u64 {
    return std.hash.Wyhash.hash(0, s);
}

/// Deprecated use `default_max_load_percentage`
pub const DefaultMaxLoadPercentage = default_max_load_percentage;

pub const default_max_load_percentage = 80;

/// General purpose hash table.
/// No order is guaranteed and any modification invalidates live iterators.
/// It provides fast operations (lookup, insertion, deletion) with quite high
/// load factors (up to 80% by default) for a low memory usage.
/// For a hash map that can be initialized directly that does not store an Allocator
/// field, see `HashMapUnmanaged`.
/// If iterating over the table entries is a strong usecase and needs to be fast,
/// prefer the alternative `std.ArrayHashMap`.
pub fn HashMap(
    comptime K: type,
    comptime V: type,
    comptime hashFn: fn (key: K) u64,
    comptime eqlFn: fn (a: K, b: K) bool,
    comptime max_load_percentage: u64,
) type {
    return struct {
        unmanaged: Unmanaged,
        allocator: *Allocator,

        pub const Unmanaged = HashMapUnmanaged(K, V, hashFn, eqlFn, max_load_percentage);
        pub const Entry = Unmanaged.Entry;
        pub const Hash = Unmanaged.Hash;
        pub const Iterator = Unmanaged.Iterator;
        pub const Size = Unmanaged.Size;
        pub const GetOrPutResult = Unmanaged.GetOrPutResult;

        const Self = @This();

        pub fn init(allocator: *Allocator) Self {
            return .{
                .unmanaged = .{},
                .allocator = allocator,
            };
        }

        pub fn deinit(self: *Self) void {
            self.unmanaged.deinit(self.allocator);
            self.* = undefined;
        }

        pub fn clearRetainingCapacity(self: *Self) void {
            return self.unmanaged.clearRetainingCapacity();
        }

        pub fn clearAndFree(self: *Self) void {
            return self.unmanaged.clearAndFree(self.allocator);
        }

        pub fn count(self: Self) Size {
            return self.unmanaged.count();
        }

        pub fn iterator(self: *const Self) Iterator {
            return self.unmanaged.iterator();
        }

        /// Get an optional pointer to the value associated with key, if present.
        pub fn getHash(key: K) u64 {
            return hashFn(key);
        }

        /// If key exists this function cannot fail.
        /// If there is an existing item with `key`, then the result
        /// `Entry` pointer points to it, and found_existing is true.
        /// Otherwise, puts a new item with undefined value, and
        /// the `Entry` pointer points to it. Caller should then initialize
        /// the value (but not the key).
        pub fn getOrPut(self: *Self, key: K) !GetOrPutResult {
            return self.unmanaged.getOrPut(self.allocator, key);
        }

        /// If key exists this function cannot fail.
        /// If there is an existing item with `key`, then the result
        /// `Entry` pointer points to it, and found_existing is true.
        /// Otherwise, puts a new item with undefined value, and
        /// the `Entry` pointer points to it. Caller should then initialize
        /// the value (but not the key).
        pub fn getOrPutWithHash(self: *Self, key: K, hash: u64) !GetOrPutResult {
            return self.unmanaged.getOrPutWithHash(self.allocator, key, hash);
        }

        /// If there is an existing item with `key`, then the result
        /// `Entry` pointer points to it, and found_existing is true.
        /// Otherwise, puts a new item with undefined value, and
        /// the `Entry` pointer points to it. Caller should then initialize
        /// the value (but not the key).
        /// If a new entry needs to be stored, this function asserts there
        /// is enough capacity to store it.
        pub fn getOrPutAssumeCapacity(self: *Self, key: K) GetOrPutResult {
            return self.unmanaged.getOrPutAssumeCapacity(key);
        }

        pub fn getOrPutValue(self: *Self, key: K, value: V) !*Entry {
            return self.unmanaged.getOrPutValue(self.allocator, key, value);
        }

        /// Increases capacity, guaranteeing that insertions up until the
        /// `expected_count` will not cause an allocation, and therefore cannot fail.
        pub fn ensureCapacity(self: *Self, expected_count: Size) !void {
            return self.unmanaged.ensureCapacity(self.allocator, expected_count);
        }

        /// Returns the number of total elements which may be present before it is
        /// no longer guaranteed that no allocations will be performed.
        pub fn capacity(self: *Self) Size {
            return self.unmanaged.capacity();
        }

        /// Clobbers any existing data. To detect if a put would clobber
        /// existing data, see `getOrPut`.
        pub fn put(self: *Self, key: K, value: V) !void {
            return self.unmanaged.put(self.allocator, key, value);
        }

        /// Clobbers any existing data. To detect if a put would clobber
        /// existing data, see `getOrPut`.
        pub fn putWithHash(self: *Self, key: K, hash: u64, value: V) !void {
            return self.unmanaged.putWithHash(self.allocator, key, hash, value);
        }

        /// Inserts a key-value pair into the hash map, asserting that no previous
        /// entry with the same key is already present
        pub fn putNoClobber(self: *Self, key: K, value: V) !void {
            return self.unmanaged.putNoClobber(self.allocator, key, value);
        }

        /// Asserts there is enough capacity to store the new key-value pair.
        /// Clobbers any existing data. To detect if a put would clobber
        /// existing data, see `getOrPutAssumeCapacity`.
        pub fn putAssumeCapacity(self: *Self, key: K, value: V) void {
            return self.unmanaged.putAssumeCapacity(key, value);
        }

        /// Asserts there is enough capacity to store the new key-value pair.
        /// Asserts that it does not clobber any existing data.
        /// To detect if a put would clobber existing data, see `getOrPutAssumeCapacity`.
        pub fn putAssumeCapacityNoClobber(self: *Self, key: K, value: V) void {
            return self.unmanaged.putAssumeCapacityNoClobber(key, value);
        }

        /// Asserts there is enough capacity to store the new key-value pair.
        /// Asserts that it does not clobber any existing data.
        /// To detect if a put would clobber existing data, see `getOrPutAssumeCapacity`.
        pub fn putAssumeCapacityNoClobberWithHash(self: *Self, key: K, hash: u64, value: V) void {
            return self.unmanaged.putAssumeCapacityNoClobberWithHash(key, hash, value);
        }

        /// Inserts a new `Entry` into the hash map, returning the previous one, if any.
        pub fn fetchPut(self: *Self, key: K, value: V) !?Entry {
            return self.unmanaged.fetchPut(self.allocator, key, value);
        }

        /// Inserts a new `Entry` into the hash map, returning the previous one, if any.
        /// If insertion happuns, asserts there is enough capacity without allocating.
        pub fn fetchPutAssumeCapacity(self: *Self, key: K, value: V) ?Entry {
            return self.unmanaged.fetchPutAssumeCapacity(key, value);
        }

        pub fn get(self: Self, key: K) ?V {
            return self.unmanaged.get(key);
        }

        pub fn getWithHash(self: Self, key: K, hash: u64) ?V {
            return self.unmanaged.getWithHash(key, hash);
        }

        pub fn getEntry(self: Self, key: K) ?*Entry {
            return self.unmanaged.getEntry(key);
        }

        pub fn getEntryWithHash(self: Self, key: K, hash: u64) ?*Entry {
            return self.unmanaged.getEntryWithHash(key, hash);
        }

        pub fn contains(self: Self, key: K) bool {
            return self.unmanaged.contains(key);
        }

        /// If there is an `Entry` with a matching key, it is deleted from
        /// the hash map, and then returned from this function.
        pub fn remove(self: *Self, key: K) ?Entry {
            return self.unmanaged.remove(key);
        }

        /// Asserts there is an `Entry` with matching key, deletes it from the hash map,
        /// and discards it.
        pub fn removeAssertDiscard(self: *Self, key: K) void {
            return self.unmanaged.removeAssertDiscard(key);
        }

        pub fn clone(self: Self) !Self {
            var other = try self.unmanaged.clone(self.allocator);
            return other.promote(self.allocator);
        }
    };
}

/// A HashMap based on open addressing and linear probing.
/// A lookup or modification typically occurs only 2 cache misses.
/// No order is guaranteed and any modification invalidates live iterators.
/// It achieves good performance with quite high load factors (by default,
/// grow is triggered at 80% full) and only one byte of overhead per element.
/// The struct itself is only 16 bytes for a small footprint. This comes at
/// the price of handling size with u32, which should be reasonnable enough
/// for almost all uses.
/// Deletions are achieved with tombstones.
pub fn HashMapUnmanaged(
    comptime K: type,
    comptime V: type,
    hashFn: fn (key: K) u64,
    eqlFn: fn (a: K, b: K) bool,
    comptime max_load_percentage: u64,
) type {
    comptime assert(max_load_percentage > 0 and max_load_percentage < 100);

    return struct {
        const Self = @This();

        // This is actually a midway pointer to the single buffer containing
        // a `Header` field, the `Metadata`s and `Entry`s.
        // At `-@sizeOf(Header)` is the Header field.
        // At `sizeOf(Metadata) * capacity + offset`, which is pointed to by
        // self.header().entries, is the array of entries.
        // This means that the hashmap only holds one live allocation, to
        // reduce memory fragmentation and struct size.
        /// Pointer to the metadata.
        metadata: ?[*]Metadata = null,

        /// Current number of elements in the hashmap.
        size: Size = 0,

        // Having a countdown to grow reduces the number of instructions to
        // execute when determining if the hashmap has enough capacity already.
        /// Number of available slots before a grow is needed to satisfy the
        /// `max_load_percentage`.
        available: Size = 0,

        // This is purely empirical and not a /very smart magic constant™/.
        /// Capacity of the first grow when bootstrapping the hashmap.
        const minimal_capacity = 8;

        // This hashmap is specially designed for sizes that fit in a u32.
        const Size = u32;

        // u64 hashes guarantee us that the fingerprint bits will never be used
        // to compute the index of a slot, maximizing the use of entropy.
        const Hash = u64;

        pub const Entry = struct {
            key: K,
            value: V,
        };

        const Header = packed struct {
            entries: [*]Entry,
            capacity: Size,
        };

        /// Metadata for a slot. It can be in three states: empty, used or
        /// tombstone. Tombstones indicate that an entry was previously used,
        /// they are a simple way to handle removal.
        /// To this state, we add 7 bits from the slot's key hash. These are
        /// used as a fast way to disambiguate between entries without
        /// having to use the equality function. If two fingerprints are
        /// different, we know that we don't have to compare the keys at all.
        /// The 7 bits are the highest ones from a 64 bit hash. This way, not
        /// only we use the `log2(capacity)` lowest bits from the hash to determine
        /// a slot index, but we use 7 more bits to quickly resolve collisions
        /// when multiple elements with different hashes end up wanting to be in the same slot.
        /// Not using the equality function means we don't have to read into
        /// the entries array, likely avoiding a cache miss and a potentially
        /// costly function call.
        const Metadata = packed struct {
            const FingerPrint = u7;

            const free: FingerPrint = 0;
            const tombstone: FingerPrint = 1;

            fingerprint: FingerPrint = free,
            used: u1 = 0,

            pub fn isUsed(self: Metadata) bool {
                return self.used == 1;
            }

            pub fn isTombstone(self: Metadata) bool {
                return !self.isUsed() and self.fingerprint == tombstone;
            }

            pub fn takeFingerprint(hash: Hash) FingerPrint {
                const hash_bits = @typeInfo(Hash).Int.bits;
                const fp_bits = @typeInfo(FingerPrint).Int.bits;
                return @truncate(FingerPrint, hash >> (hash_bits - fp_bits));
            }

            pub fn fill(self: *Metadata, fp: FingerPrint) void {
                self.used = 1;
                self.fingerprint = fp;
            }

            pub fn remove(self: *Metadata) void {
                self.used = 0;
                self.fingerprint = tombstone;
            }
        };

        comptime {
            assert(@sizeOf(Metadata) == 1);
            assert(@alignOf(Metadata) == 1);
        }

        const Iterator = struct {
            hm: *const Self,
            index: Size = 0,

            pub fn next(it: *Iterator) ?*Entry {
                if (std.builtin.mode != .ReleaseFast) assert(it.index <= it.hm.capacity());
                if (it.hm.size == 0) return null;

                const cap = it.hm.capacity();
                const end = it.hm.metadata.? + cap;
                var metadata = it.hm.metadata.? + it.index;

                while (metadata != end) : ({
                    metadata += 1;
                    it.index += 1;
                }) {
                    if (metadata[0].isUsed()) {
                        const entry = &it.hm.entries()[it.index];
                        it.index += 1;
                        return entry;
                    }
                }

                return null;
            }
        };

        pub const GetOrPutResult = struct {
            entry: *Entry,
            found_existing: bool,
        };

        pub const Managed = HashMap(K, V, hashFn, eqlFn, max_load_percentage);

        pub fn promote(self: Self, allocator: *Allocator) Managed {
            return .{
                .unmanaged = self,
                .allocator = allocator,
            };
        }

        fn isUnderMaxLoadPercentage(size: Size, cap: Size) bool {
            return size * 100 < max_load_percentage * cap;
        }

        pub fn deinit(self: *Self, allocator: *Allocator) void {
            self.deallocate(allocator);
            self.* = undefined;
        }

        fn deallocate(self: *Self, allocator: *Allocator) void {
            if (self.metadata == null) return;

            const cap = self.capacity();
            const meta_size = @sizeOf(Header) + cap * @sizeOf(Metadata);

            const alignment = @alignOf(Entry) - 1;
            const entries_size = @as(usize, cap) * @sizeOf(Entry) + alignment;

            const total_size = meta_size + entries_size;

            var slice: []u8 = undefined;
            slice.ptr = @intToPtr([*]u8, @ptrToInt(self.header()));
            slice.len = total_size;
            allocator.free(slice);

            self.metadata = null;
            self.available = 0;
        }

        fn capacityForSize(size: Size) Size {
            var new_cap = @truncate(u32, (@as(u64, size) * 100) / max_load_percentage + 1);
            new_cap = math.ceilPowerOfTwo(u32, new_cap) catch unreachable;
            return new_cap;
        }

        pub fn ensureCapacity(self: *Self, allocator: *Allocator, new_size: Size) !void {
            if (new_size > self.size)
                try self.growIfNeeded(allocator, new_size - self.size);
        }

        pub fn clearRetainingCapacity(self: *Self) void {
            if (self.metadata) |_| {
                self.initMetadatas();
                self.size = 0;
                self.available = @truncate(u32, (self.capacity() * max_load_percentage) / 100);
            }
        }

        pub fn clearAndFree(self: *Self, allocator: *Allocator) void {
            self.deallocate(allocator);
            self.size = 0;
            self.available = 0;
        }

        pub fn count(self: *const Self) Size {
            return self.size;
        }

        fn header(self: *const Self) *Header {
            return @ptrCast(*Header, @ptrCast([*]Header, self.metadata.?) - 1);
        }

        fn entries(self: *const Self) [*]Entry {
            return self.header().entries;
        }

        pub fn capacity(self: *const Self) Size {
            if (self.metadata == null) return 0;

            return self.header().capacity;
        }

        pub fn iterator(self: *const Self) Iterator {
            return .{ .hm = self };
        }

        /// Insert an entry in the map. Assumes it is not already present.
        pub fn putNoClobber(self: *Self, allocator: *Allocator, key: K, value: V) !void {
            if (std.builtin.mode != .ReleaseFast) assert(!self.contains(key));
            try self.growIfNeeded(allocator, 1);

            self.putAssumeCapacityNoClobber(key, value);
        }

        /// Asserts there is enough capacity to store the new key-value pair.
        /// Clobbers any existing data. To detect if a put would clobber
        /// existing data, see `getOrPutAssumeCapacity`.
        pub fn putAssumeCapacity(self: *Self, key: K, value: V) void {
            const gop = self.getOrPutAssumeCapacity(key);
            gop.entry.value = value;
        }

        /// Insert an entry in the map. Assumes it is not already present,
        /// and that no allocation is needed.
        pub fn putAssumeCapacityNoClobber(self: *Self, key: K, value: V) void {
            if (std.builtin.mode != .ReleaseFast) assert(!self.contains(key));

            const hash = hashFn(key);
            putAssumeCapacityNoClobberWithHash(self, key, hash, value);
        }

        /// Insert an entry in the map. Assumes it is not already present,
        /// and that no allocation is needed.
        pub fn putAssumeCapacityNoClobberWithHash(self: *Self, key: K, hash: u64, value: V) void {
            const mask = self.capacity() - 1;
            var idx = @truncate(usize, hash & mask);

            var metadata = self.metadata.? + idx;
            while (metadata[0].isUsed()) {
                idx = (idx + 1) & mask;
                metadata = self.metadata.? + idx;
            }

            if (!metadata[0].isTombstone()) {
                if (std.builtin.mode != .ReleaseFast) assert(self.available > 0);
                self.available -= 1;
            }

            const fingerprint = Metadata.takeFingerprint(hash);
            metadata[0].fill(fingerprint);
            self.entries()[idx] = Entry{ .key = key, .value = value };

            self.size += 1;
        }

        /// Inserts a new `Entry` into the hash map, returning the previous one, if any.
        pub fn fetchPut(self: *Self, allocator: *Allocator, key: K, value: V) !?Entry {
            const gop = try self.getOrPut(allocator, key);
            var result: ?Entry = null;
            if (gop.found_existing) {
                result = gop.entry.*;
            }
            gop.entry.value = value;
            return result;
        }

        /// Inserts a new `Entry` into the hash map, returning the previous one, if any.
        /// If insertion happens, asserts there is enough capacity without allocating.
        pub fn fetchPutAssumeCapacity(self: *Self, key: K, value: V) ?Entry {
            const gop = self.getOrPutAssumeCapacity(key);
            var result: ?Entry = null;
            if (gop.found_existing) {
                result = gop.entry.*;
            }
            gop.entry.value = value;
            return result;
        }

        pub fn getEntryWithHash(self: Self, key: K, hash: u64) ?*Entry {
            if (self.size == 0) {
                return null;
            }

            return @call(.{ .modifier = .always_inline }, _getEntryWithHash, .{ self, key, hash });
        }

        fn _getEntryWithHash(self: Self, key: K, hash: u64) ?*Entry {
            const mask = self.capacity() - 1;
            const fingerprint = Metadata.takeFingerprint(hash);
            var idx = @truncate(usize, hash & mask);

            var metadata = self.metadata.? + idx;
            while (metadata[0].isUsed() or metadata[0].isTombstone()) {
                if (metadata[0].isUsed() and metadata[0].fingerprint == fingerprint) {
                    const entry = &self.entries()[idx];
                    if (eqlFn(entry.key, key)) {
                        return entry;
                    }
                }
                idx = (idx + 1) & mask;
                metadata = self.metadata.? + idx;
            }

            return null;
        }

        pub fn getEntry(self: Self, key: K) ?*Entry {
            if (self.size == 0) {
                return null;
            }

            return @call(.{ .modifier = .always_inline }, _getEntryWithHash, .{ self, key, hashFn(key) });
        }

        /// Insert an entry if the associated key is not already present, otherwise update preexisting value.
        pub fn put(self: *Self, allocator: *Allocator, key: K, value: V) !void {
            const result = try self.getOrPut(allocator, key);
            result.entry.value = value;
        }

        /// Insert an entry if the associated key is not already present, otherwise update preexisting value.
        pub fn putWithHash(self: *Self, allocator: *Allocator, key: K, hash: u64, value: V) !void {
            const result = try self.getOrPutWithHash(allocator, key, hash);
            result.entry.value = value;
        }

        /// Get an optional pointer to the value associated with key, if present.
        pub fn getHash(self: Self, key: K) u64 {
            return hashFn(key);
        }

        /// Get an optional pointer to the value associated with key, if present.
        pub fn getWithHash(self: Self, key: K, hash: u64) ?V {
            if (self.size == 0) {
                return null;
            }

            const mask = self.capacity() - 1;
            const fingerprint = Metadata.takeFingerprint(hash);
            var idx = @truncate(usize, hash & mask);

            var metadata = self.metadata.? + idx;
            while (metadata[0].isUsed() or metadata[0].isTombstone()) {
                if (metadata[0].isUsed() and metadata[0].fingerprint == fingerprint) {
                    const entry = &self.entries()[idx];
                    if (eqlFn(entry.key, key)) {
                        return entry.value;
                    }
                }
                idx = (idx + 1) & mask;
                metadata = self.metadata.? + idx;
            }

            return null;
        }

        /// Get an optional pointer to the value associated with key, if present.
        pub fn get(self: Self, key: K) ?V {
            if (self.size == 0) {
                return null;
            }

            const hash = hashFn(key);
            const mask = self.capacity() - 1;
            const fingerprint = Metadata.takeFingerprint(hash);
            var idx = @truncate(usize, hash & mask);

            var metadata = self.metadata.? + idx;
            while (metadata[0].isUsed() or metadata[0].isTombstone()) {
                if (metadata[0].isUsed() and metadata[0].fingerprint == fingerprint) {
                    const entry = &self.entries()[idx];
                    if (eqlFn(entry.key, key)) {
                        return entry.value;
                    }
                }
                idx = (idx + 1) & mask;
                metadata = self.metadata.? + idx;
            }

            return null;
        }

        pub fn getOrPut(self: *Self, allocator: *Allocator, key: K) !GetOrPutResult {
            try self.growIfNeeded(allocator, 1);

            return self.getOrPutAssumeCapacity(key);
        }

        pub fn getOrPutWithHash(self: *Self, allocator: *Allocator, key: K, hash: u64) !GetOrPutResult {
            try self.growIfNeeded(allocator, 1);

            return self.getOrPutAssumeCapacityWithHash(key, hash);
        }

        pub fn getOrPutAssumeCapacity(self: *Self, key: K) GetOrPutResult {
            return @call(.{ .modifier = .always_inline }, Self.getOrPutAssumeCapacityWithHash, .{ self, key, hashFn(key) });
        }

        pub fn getOrPutAssumeCapacityWithHash(self: *Self, key: K, hash: u64) GetOrPutResult {
            const mask = self.capacity() - 1;
            const fingerprint = Metadata.takeFingerprint(hash);
            var idx = @truncate(usize, hash & mask);

            var first_tombstone_idx: usize = self.capacity(); // invalid index
            var metadata = self.metadata.? + idx;
            while (metadata[0].isUsed() or metadata[0].isTombstone()) {
                if (metadata[0].isUsed() and metadata[0].fingerprint == fingerprint) {
                    const entry = &self.entries()[idx];
                    if (eqlFn(entry.key, key)) {
                        return GetOrPutResult{ .entry = entry, .found_existing = true };
                    }
                } else if (first_tombstone_idx == self.capacity() and metadata[0].isTombstone()) {
                    first_tombstone_idx = idx;
                }

                idx = (idx + 1) & mask;
                metadata = self.metadata.? + idx;
            }

            if (first_tombstone_idx < self.capacity()) {
                // Cheap try to lower probing lengths after deletions. Recycle a tombstone.
                idx = first_tombstone_idx;
                metadata = self.metadata.? + idx;
            } else {
                // We're using a slot previously free.
                self.available -= 1;
            }

            metadata[0].fill(fingerprint);
            const entry = &self.entries()[idx];
            entry.* = .{ .key = key, .value = undefined };
            self.size += 1;

            return GetOrPutResult{ .entry = entry, .found_existing = false };
        }

        pub fn getOrPutValue(self: *Self, allocator: *Allocator, key: K, value: V) !*Entry {
            const res = try self.getOrPut(allocator, key);
            if (!res.found_existing) res.entry.value = value;
            return res.entry;
        }

        /// Return true if there is a value associated with key in the map.
        pub fn contains(self: *const Self, key: K) bool {
            return self.get(key) != null;
        }

        /// If there is an `Entry` with a matching key, it is deleted from
        /// the hash map, and then returned from this function.
        pub fn remove(self: *Self, key: K) ?Entry {
            if (self.size == 0) return null;

            const hash = hashFn(key);
            const mask = self.capacity() - 1;
            const fingerprint = Metadata.takeFingerprint(hash);
            var idx = @truncate(usize, hash & mask);

            var metadata = self.metadata.? + idx;
            while (metadata[0].isUsed() or metadata[0].isTombstone()) {
                if (metadata[0].isUsed() and metadata[0].fingerprint == fingerprint) {
                    const entry = &self.entries()[idx];
                    if (eqlFn(entry.key, key)) {
                        const removed_entry = entry.*;
                        metadata[0].remove();
                        entry.* = undefined;
                        self.size -= 1;
                        return removed_entry;
                    }
                }
                idx = (idx + 1) & mask;
                metadata = self.metadata.? + idx;
            }

            return null;
        }

        /// Asserts there is an `Entry` with matching key, deletes it from the hash map,
        /// and discards it.
        pub fn removeAssertDiscard(self: *Self, key: K) void {
            if (std.builtin.mode != .ReleaseFast) assert(self.contains(key));

            const hash = hashFn(key);
            const mask = self.capacity() - 1;
            const fingerprint = Metadata.takeFingerprint(hash);
            var idx = @truncate(usize, hash & mask);

            var metadata = self.metadata.? + idx;
            while (metadata[0].isUsed() or metadata[0].isTombstone()) {
                if (metadata[0].isUsed() and metadata[0].fingerprint == fingerprint) {
                    const entry = &self.entries()[idx];
                    if (eqlFn(entry.key, key)) {
                        metadata[0].remove();
                        entry.* = undefined;
                        self.size -= 1;
                        return;
                    }
                }
                idx = (idx + 1) & mask;
                metadata = self.metadata.? + idx;
            }

            unreachable;
        }

        fn initMetadatas(self: *Self) void {
            @memset(@ptrCast([*]u8, self.metadata.?), 0, @sizeOf(Metadata) * self.capacity());
        }

        // This counts the number of occupied slots, used + tombstones, which is
        // what has to stay under the max_load_percentage of capacity.
        fn load(self: *const Self) Size {
            const max_load = (self.capacity() * max_load_percentage) / 100;
            if (std.builtin.mode != .ReleaseFast) assert(max_load >= self.available);
            return @truncate(Size, max_load - self.available);
        }

        fn growIfNeeded(self: *Self, allocator: *Allocator, new_count: Size) !void {
            if (new_count > self.available) {
                try self.grow(allocator, capacityForSize(self.load() + new_count));
            }
        }

        pub fn clone(self: Self, allocator: *Allocator) !Self {
            var other = Self{};
            if (self.size == 0)
                return other;

            const new_cap = capacityForSize(self.size);
            try other.allocate(allocator, new_cap);
            other.initMetadatas();
            other.available = @truncate(u32, (new_cap * max_load_percentage) / 100);

            var i: Size = 0;
            var metadata = self.metadata.?;
            var entr = self.entries();
            while (i < self.capacity()) : (i += 1) {
                if (metadata[i].isUsed()) {
                    const entry = &entr[i];
                    other.putAssumeCapacityNoClobber(entry.key, entry.value);
                    if (other.size == self.size)
                        break;
                }
            }

            return other;
        }

        fn grow(self: *Self, allocator: *Allocator, new_capacity: Size) !void {
            const new_cap = std.math.max(new_capacity, minimal_capacity);
            if (std.builtin.mode != .ReleaseFast) assert(new_cap > self.capacity());
            if (std.builtin.mode != .ReleaseFast) assert(std.math.isPowerOfTwo(new_cap));

            var map = Self{};
            defer map.deinit(allocator);
            try map.allocate(allocator, new_cap);
            map.initMetadatas();
            map.available = @truncate(u32, (new_cap * max_load_percentage) / 100);

            if (self.size != 0) {
                const old_capacity = self.capacity();
                var i: Size = 0;
                var metadata = self.metadata.?;
                var entr = self.entries();
                while (i < old_capacity) : (i += 1) {
                    if (metadata[i].isUsed()) {
                        const entry = &entr[i];
                        map.putAssumeCapacityNoClobber(entry.key, entry.value);
                        if (map.size == self.size)
                            break;
                    }
                }
            }

            self.size = 0;
            std.mem.swap(Self, self, &map);
        }

        fn allocate(self: *Self, allocator: *Allocator, new_capacity: Size) !void {
            const meta_size = @sizeOf(Header) + new_capacity * @sizeOf(Metadata);

            const alignment = @alignOf(Entry) - 1;
            const entries_size = @as(usize, new_capacity) * @sizeOf(Entry) + alignment;

            const total_size = meta_size + entries_size;

            const slice = try allocator.alignedAlloc(u8, @alignOf(Header), total_size);
            const ptr = @ptrToInt(slice.ptr);

            const metadata = ptr + @sizeOf(Header);
            var entry_ptr = ptr + meta_size;
            entry_ptr = (entry_ptr + alignment) & ~@as(usize, alignment);
            if (std.builtin.mode != .ReleaseFast) assert(entry_ptr + @as(usize, new_capacity) * @sizeOf(Entry) <= ptr + total_size);

            const hdr = @intToPtr(*Header, ptr);
            hdr.entries = @intToPtr([*]Entry, entry_ptr);
            hdr.capacity = new_capacity;
            self.metadata = @intToPtr([*]Metadata, metadata);
        }
    };
}

const testing = std.testing;
const expect = std.testing.expect;
const expectEqual = std.testing.expectEqual;

test "std.hash_map basic usage" {
    var map = AutoHashMap(u32, u32).init(std.testing.allocator);
    defer map.deinit();

    const count = 5;
    var i: u32 = 0;
    var total: u32 = 0;
    while (i < count) : (i += 1) {
        try map.put(i, i);
        total += i;
    }

    var sum: u32 = 0;
    var it = map.iterator();
    while (it.next()) |kv| {
        sum += kv.key;
    }
    try expect(sum == total);

    i = 0;
    sum = 0;
    while (i < count) : (i += 1) {
        try expectEqual(map.get(i).?, i);
        sum += map.get(i).?;
    }
    try expectEqual(total, sum);
}

test "std.hash_map ensureCapacity" {
    var map = AutoHashMap(i32, i32).init(std.testing.allocator);
    defer map.deinit();

    try map.ensureCapacity(20);
    const initial_capacity = map.capacity();
    try testing.expect(initial_capacity >= 20);
    var i: i32 = 0;
    while (i < 20) : (i += 1) {
        try testing.expect(map.fetchPutAssumeCapacity(i, i + 10) == null);
    }
    // shouldn't resize from putAssumeCapacity
    try testing.expect(initial_capacity == map.capacity());
}

test "std.hash_map ensureCapacity with tombstones" {
    var map = AutoHashMap(i32, i32).init(std.testing.allocator);
    defer map.deinit();

    var i: i32 = 0;
    while (i < 100) : (i += 1) {
        try map.ensureCapacity(@intCast(u32, map.count() + 1));
        map.putAssumeCapacity(i, i);
        // Remove to create tombstones that still count as load in the hashmap.
        _ = map.remove(i);
    }
}

test "std.hash_map clearRetainingCapacity" {
    var map = AutoHashMap(u32, u32).init(std.testing.allocator);
    defer map.deinit();

    map.clearRetainingCapacity();

    try map.put(1, 1);
    try expectEqual(map.get(1).?, 1);
    try expectEqual(map.count(), 1);

    map.clearRetainingCapacity();
    map.putAssumeCapacity(1, 1);
    try expectEqual(map.get(1).?, 1);
    try expectEqual(map.count(), 1);

    const cap = map.capacity();
    try expect(cap > 0);

    map.clearRetainingCapacity();
    map.clearRetainingCapacity();
    try expectEqual(map.count(), 0);
    try expectEqual(map.capacity(), cap);
    try expect(!map.contains(1));
}

test "std.hash_map grow" {
    var map = AutoHashMap(u32, u32).init(std.testing.allocator);
    defer map.deinit();

    const growTo = 12456;

    var i: u32 = 0;
    while (i < growTo) : (i += 1) {
        try map.put(i, i);
    }
    try expectEqual(map.count(), growTo);

    i = 0;
    var it = map.iterator();
    while (it.next()) |kv| {
        try expectEqual(kv.key, kv.value);
        i += 1;
    }
    try expectEqual(i, growTo);

    i = 0;
    while (i < growTo) : (i += 1) {
        try expectEqual(map.get(i).?, i);
    }
}

test "std.hash_map clone" {
    var map = AutoHashMap(u32, u32).init(std.testing.allocator);
    defer map.deinit();

    var a = try map.clone();
    defer a.deinit();

    try expectEqual(a.count(), 0);

    try a.put(1, 1);
    try a.put(2, 2);
    try a.put(3, 3);

    var b = try a.clone();
    defer b.deinit();

    try expectEqual(b.count(), 3);
    try expectEqual(b.get(1), 1);
    try expectEqual(b.get(2), 2);
    try expectEqual(b.get(3), 3);
}

test "std.hash_map ensureCapacity with existing elements" {
    var map = AutoHashMap(u32, u32).init(std.testing.allocator);
    defer map.deinit();

    try map.put(0, 0);
    try expectEqual(map.count(), 1);
    try expectEqual(map.capacity(), @TypeOf(map).Unmanaged.minimal_capacity);

    try map.ensureCapacity(65);
    try expectEqual(map.count(), 1);
    try expectEqual(map.capacity(), 128);
}

test "std.hash_map ensureCapacity satisfies max load factor" {
    var map = AutoHashMap(u32, u32).init(std.testing.allocator);
    defer map.deinit();

    try map.ensureCapacity(127);
    try expectEqual(map.capacity(), 256);
}

test "std.hash_map remove" {
    var map = AutoHashMap(u32, u32).init(std.testing.allocator);
    defer map.deinit();

    var i: u32 = 0;
    while (i < 16) : (i += 1) {
        try map.put(i, i);
    }

    i = 0;
    while (i < 16) : (i += 1) {
        if (i % 3 == 0) {
            _ = map.remove(i);
        }
    }
    try expectEqual(map.count(), 10);
    var it = map.iterator();
    while (it.next()) |kv| {
        try expectEqual(kv.key, kv.value);
        try expect(kv.key % 3 != 0);
    }

    i = 0;
    while (i < 16) : (i += 1) {
        if (i % 3 == 0) {
            try expect(!map.contains(i));
        } else {
            try expectEqual(map.get(i).?, i);
        }
    }
}

test "std.hash_map reverse removes" {
    var map = AutoHashMap(u32, u32).init(std.testing.allocator);
    defer map.deinit();

    var i: u32 = 0;
    while (i < 16) : (i += 1) {
        try map.putNoClobber(i, i);
    }

    i = 16;
    while (i > 0) : (i -= 1) {
        _ = map.remove(i - 1);
        try expect(!map.contains(i - 1));
        var j: u32 = 0;
        while (j < i - 1) : (j += 1) {
            try expectEqual(map.get(j).?, j);
        }
    }

    try expectEqual(map.count(), 0);
}

test "std.hash_map multiple removes on same metadata" {
    var map = AutoHashMap(u32, u32).init(std.testing.allocator);
    defer map.deinit();

    var i: u32 = 0;
    while (i < 16) : (i += 1) {
        try map.put(i, i);
    }

    _ = map.remove(7);
    _ = map.remove(15);
    _ = map.remove(14);
    _ = map.remove(13);
    try expect(!map.contains(7));
    try expect(!map.contains(15));
    try expect(!map.contains(14));
    try expect(!map.contains(13));

    i = 0;
    while (i < 13) : (i += 1) {
        if (i == 7) {
            try expect(!map.contains(i));
        } else {
            try expectEqual(map.get(i).?, i);
        }
    }

    try map.put(15, 15);
    try map.put(13, 13);
    try map.put(14, 14);
    try map.put(7, 7);
    i = 0;
    while (i < 16) : (i += 1) {
        try expectEqual(map.get(i).?, i);
    }
}

test "std.hash_map put and remove loop in random order" {
    var map = AutoHashMap(u32, u32).init(std.testing.allocator);
    defer map.deinit();

    var keys = std.ArrayList(u32).init(std.testing.allocator);
    defer keys.deinit();

    const size = 32;
    const iterations = 100;

    var i: u32 = 0;
    while (i < size) : (i += 1) {
        try keys.append(i);
    }
    var rng = std.rand.DefaultPrng.init(0);

    while (i < iterations) : (i += 1) {
        std.rand.Random.shuffle(&rng.random, u32, keys.items);

        for (keys.items) |key| {
            try map.put(key, key);
        }
        try expectEqual(map.count(), size);

        for (keys.items) |key| {
            _ = map.remove(key);
        }
        try expectEqual(map.count(), 0);
    }
}

test "std.hash_map remove one million elements in random order" {
    const Map = AutoHashMap(u32, u32);
    const n = 1000 * 1000;
    var map = Map.init(std.heap.page_allocator);
    defer map.deinit();

    var keys = std.ArrayList(u32).init(std.heap.page_allocator);
    defer keys.deinit();

    var i: u32 = 0;
    while (i < n) : (i += 1) {
        keys.append(i) catch unreachable;
    }

    var rng = std.rand.DefaultPrng.init(0);
    std.rand.Random.shuffle(&rng.random, u32, keys.items);

    for (keys.items) |key| {
        map.put(key, key) catch unreachable;
    }

    std.rand.Random.shuffle(&rng.random, u32, keys.items);
    i = 0;
    while (i < n) : (i += 1) {
        const key = keys.items[i];
        _ = map.remove(key);
    }
}

test "std.hash_map put" {
    var map = AutoHashMap(u32, u32).init(std.testing.allocator);
    defer map.deinit();

    var i: u32 = 0;
    while (i < 16) : (i += 1) {
        try map.put(i, i);
    }

    i = 0;
    while (i < 16) : (i += 1) {
        try expectEqual(map.get(i).?, i);
    }

    i = 0;
    while (i < 16) : (i += 1) {
        try map.put(i, i * 16 + 1);
    }

    i = 0;
    while (i < 16) : (i += 1) {
        try expectEqual(map.get(i).?, i * 16 + 1);
    }
}

test "std.hash_map putAssumeCapacity" {
    var map = AutoHashMap(u32, u32).init(std.testing.allocator);
    defer map.deinit();

    try map.ensureCapacity(20);
    var i: u32 = 0;
    while (i < 20) : (i += 1) {
        map.putAssumeCapacityNoClobber(i, i);
    }

    i = 0;
    var sum = i;
    while (i < 20) : (i += 1) {
        sum += map.get(i).?;
    }
    try expectEqual(sum, 190);

    i = 0;
    while (i < 20) : (i += 1) {
        map.putAssumeCapacity(i, 1);
    }

    i = 0;
    sum = i;
    while (i < 20) : (i += 1) {
        sum += map.get(i).?;
    }
    try expectEqual(sum, 20);
}

test "std.hash_map getOrPut" {
    var map = AutoHashMap(u32, u32).init(std.testing.allocator);
    defer map.deinit();

    var i: u32 = 0;
    while (i < 10) : (i += 1) {
        try map.put(i * 2, 2);
    }

    i = 0;
    while (i < 20) : (i += 1) {
        var n = try map.getOrPutValue(i, 1);
    }

    i = 0;
    var sum = i;
    while (i < 20) : (i += 1) {
        sum += map.get(i).?;
    }

    try expectEqual(sum, 30);
}

test "std.hash_map basic hash map usage" {
    var map = AutoHashMap(i32, i32).init(std.testing.allocator);
    defer map.deinit();

    try testing.expect((try map.fetchPut(1, 11)) == null);
    try testing.expect((try map.fetchPut(2, 22)) == null);
    try testing.expect((try map.fetchPut(3, 33)) == null);
    try testing.expect((try map.fetchPut(4, 44)) == null);

    try map.putNoClobber(5, 55);
    try testing.expect((try map.fetchPut(5, 66)).?.value == 55);
    try testing.expect((try map.fetchPut(5, 55)).?.value == 66);

    const gop1 = try map.getOrPut(5);
    try testing.expect(gop1.found_existing == true);
    try testing.expect(gop1.entry.value == 55);
    gop1.entry.value = 77;
    try testing.expect(map.getEntry(5).?.value == 77);

    const gop2 = try map.getOrPut(99);
    try testing.expect(gop2.found_existing == false);
    gop2.entry.value = 42;
    try testing.expect(map.getEntry(99).?.value == 42);

    const gop3 = try map.getOrPutValue(5, 5);
    try testing.expect(gop3.value == 77);

    const gop4 = try map.getOrPutValue(100, 41);
    try testing.expect(gop4.value == 41);

    try testing.expect(map.contains(2));
    try testing.expect(map.getEntry(2).?.value == 22);
    try testing.expect(map.get(2).? == 22);

    const rmv1 = map.remove(2);
    try testing.expect(rmv1.?.key == 2);
    try testing.expect(rmv1.?.value == 22);
    try testing.expect(map.remove(2) == null);
    try testing.expect(map.getEntry(2) == null);
    try testing.expect(map.get(2) == null);

    map.removeAssertDiscard(3);
}

test "std.hash_map clone" {
    var original = AutoHashMap(i32, i32).init(std.testing.allocator);
    defer original.deinit();

    var i: u8 = 0;
    while (i < 10) : (i += 1) {
        try original.putNoClobber(i, i * 10);
    }

    var copy = try original.clone();
    defer copy.deinit();

    i = 0;
    while (i < 10) : (i += 1) {
        try testing.expect(copy.get(i).? == i * 10);
    }
}
