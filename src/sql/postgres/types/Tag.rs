//     select b.typname,  b.oid, b.typarray
//       from pg_catalog.pg_type a
//       left join pg_catalog.pg_type b on b.oid = a.typelem
//       where a.typcategory = 'A'
//       group by b.oid, b.typarray
//       order by b.oid
// ;
//                 typname                |  oid  | typarray
// ---------------------------------------+-------+----------
//  bool                                  |    16 |     1000
//  bytea                                 |    17 |     1001
//  char                                  |    18 |     1002
//  name                                  |    19 |     1003
//  int8                                  |    20 |     1016
//  int2                                  |    21 |     1005
//  int2vector                            |    22 |     1006
//  int4                                  |    23 |     1007
//  regproc                               |    24 |     1008
//  text                                  |    25 |     1009
//  oid                                   |    26 |     1028
//  tid                                   |    27 |     1010
//  xid                                   |    28 |     1011
//  cid                                   |    29 |     1012
//  oidvector                             |    30 |     1013
//  pg_type                               |    71 |      210
//  pg_attribute                          |    75 |      270
//  pg_proc                               |    81 |      272
//  pg_class                              |    83 |      273
//  json                                  |   114 |      199
//  xml                                   |   142 |      143
//  point                                 |   600 |     1017
//  lseg                                  |   601 |     1018
//  path                                  |   602 |     1019
//  box                                   |   603 |     1020
//  polygon                               |   604 |     1027
//  line                                  |   628 |      629
//  cidr                                  |   650 |      651
//  float4                                |   700 |     1021
//  float8                                |   701 |     1022
//  circle                                |   718 |      719
//  macaddr8                              |   774 |      775
//  money                                 |   790 |      791
//  macaddr                               |   829 |     1040
//  inet                                  |   869 |     1041
//  aclitem                               |  1033 |     1034
//  bpchar                                |  1042 |     1014
//  varchar                               |  1043 |     1015
//  date                                  |  1082 |     1182
//  time                                  |  1083 |     1183
//  timestamp                             |  1114 |     1115
//  timestamptz                           |  1184 |     1185
//  interval                              |  1186 |     1187
//  pg_database                           |  1248 |    12052
//  timetz                                |  1266 |     1270
//  bit                                   |  1560 |     1561
//  varbit                                |  1562 |     1563
//  numeric                               |  1700 |     1231

use super::int_types::Short;

// Zig: `enum(short) { ..., _ }` — non-exhaustive (any `short` value is a valid `Tag`).
// A `#[repr(i16)] enum` cannot hold arbitrary values, so model as a transparent newtype
// with associated consts.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub struct Tag(pub Short);

#[allow(non_upper_case_globals)]
impl Tag {
    pub const bool: Tag = Tag(16);
    pub const bytea: Tag = Tag(17);
    pub const char: Tag = Tag(18);
    pub const name: Tag = Tag(19);
    pub const int8: Tag = Tag(20);
    pub const int2: Tag = Tag(21);
    pub const int2vector: Tag = Tag(22);
    pub const int4: Tag = Tag(23);
    // pub const regproc: Tag = Tag(24);
    pub const text: Tag = Tag(25);
    pub const oid: Tag = Tag(26);
    // pub const tid: Tag = Tag(27);
    pub const xid: Tag = Tag(28);
    pub const cid: Tag = Tag(29);
    // pub const oidvector: Tag = Tag(30);
    // pub const pg_type: Tag = Tag(71);
    // pub const pg_attribute: Tag = Tag(75);
    // pub const pg_proc: Tag = Tag(81);
    // pub const pg_class: Tag = Tag(83);
    pub const json: Tag = Tag(114);
    pub const xml: Tag = Tag(142);
    pub const point: Tag = Tag(600);
    pub const lseg: Tag = Tag(601);
    pub const path: Tag = Tag(602);
    pub const r#box: Tag = Tag(603);
    pub const polygon: Tag = Tag(604);
    pub const line: Tag = Tag(628);
    pub const cidr: Tag = Tag(650);
    pub const float4: Tag = Tag(700);
    pub const float8: Tag = Tag(701);
    pub const circle: Tag = Tag(718);
    pub const macaddr8: Tag = Tag(774);
    pub const money: Tag = Tag(790);
    pub const macaddr: Tag = Tag(829);
    pub const inet: Tag = Tag(869);
    pub const aclitem: Tag = Tag(1033);
    pub const bpchar: Tag = Tag(1042);
    pub const varchar: Tag = Tag(1043);
    pub const date: Tag = Tag(1082);
    pub const time: Tag = Tag(1083);
    pub const timestamp: Tag = Tag(1114);
    pub const timestamptz: Tag = Tag(1184);
    pub const interval: Tag = Tag(1186);
    pub const pg_database: Tag = Tag(1248);
    pub const timetz: Tag = Tag(1266);
    pub const bit: Tag = Tag(1560);
    pub const varbit: Tag = Tag(1562);
    pub const numeric: Tag = Tag(1700);
    pub const uuid: Tag = Tag(2950);

    pub const bool_array: Tag = Tag(1000);
    pub const bytea_array: Tag = Tag(1001);
    pub const char_array: Tag = Tag(1002);
    pub const name_array: Tag = Tag(1003);
    pub const int8_array: Tag = Tag(1016);
    pub const int2_array: Tag = Tag(1005);
    pub const int2vector_array: Tag = Tag(1006);
    pub const int4_array: Tag = Tag(1007);
    // pub const regproc_array: Tag = Tag(1008);
    pub const text_array: Tag = Tag(1009);
    pub const oid_array: Tag = Tag(1028);
    pub const tid_array: Tag = Tag(1010);
    pub const xid_array: Tag = Tag(1011);
    pub const cid_array: Tag = Tag(1012);
    // pub const oidvector_array: Tag = Tag(1013);
    // pub const pg_type_array: Tag = Tag(210);
    // pub const pg_attribute_array: Tag = Tag(270);
    // pub const pg_proc_array: Tag = Tag(272);
    // pub const pg_class_array: Tag = Tag(273);
    pub const json_array: Tag = Tag(199);
    pub const xml_array: Tag = Tag(143);
    pub const point_array: Tag = Tag(1017);
    pub const lseg_array: Tag = Tag(1018);
    pub const path_array: Tag = Tag(1019);
    pub const box_array: Tag = Tag(1020);
    pub const polygon_array: Tag = Tag(1027);
    pub const line_array: Tag = Tag(629);
    pub const cidr_array: Tag = Tag(651);
    pub const float4_array: Tag = Tag(1021);
    pub const float8_array: Tag = Tag(1022);
    pub const circle_array: Tag = Tag(719);
    pub const macaddr8_array: Tag = Tag(775);
    pub const money_array: Tag = Tag(791);
    pub const macaddr_array: Tag = Tag(1040);
    pub const inet_array: Tag = Tag(1041);
    pub const aclitem_array: Tag = Tag(1034);
    pub const bpchar_array: Tag = Tag(1014);
    pub const varchar_array: Tag = Tag(1015);
    pub const date_array: Tag = Tag(1182);
    pub const time_array: Tag = Tag(1183);
    pub const timestamp_array: Tag = Tag(1115);
    pub const timestamptz_array: Tag = Tag(1185);
    pub const interval_array: Tag = Tag(1187);
    pub const pg_database_array: Tag = Tag(12052);
    pub const timetz_array: Tag = Tag(1270);
    pub const bit_array: Tag = Tag(1561);
    pub const varbit_array: Tag = Tag(1563);
    pub const numeric_array: Tag = Tag(1231);
    pub const jsonb: Tag = Tag(3802);
    pub const jsonb_array: Tag = Tag(3807);
    // Not really sure what this is.
    pub const jsonpath: Tag = Tag(4072);
    pub const jsonpath_array: Tag = Tag(4073);
    // another oid for pg_database
    pub const pg_database_array2: Tag = Tag(10052);

    pub fn tag_name(self) -> Option<&'static str> {
        Some(match self {
            Tag::bool => "bool",
            Tag::bytea => "bytea",
            Tag::char => "char",
            Tag::name => "name",
            Tag::int8 => "int8",
            Tag::int2 => "int2",
            Tag::int2vector => "int2vector",
            Tag::int4 => "int4",
            Tag::text => "text",
            Tag::oid => "oid",
            Tag::xid => "xid",
            Tag::cid => "cid",
            Tag::json => "json",
            Tag::xml => "xml",
            Tag::point => "point",
            Tag::lseg => "lseg",
            Tag::path => "path",
            Tag::r#box => "box",
            Tag::polygon => "polygon",
            Tag::line => "line",
            Tag::cidr => "cidr",
            Tag::float4 => "float4",
            Tag::float8 => "float8",
            Tag::circle => "circle",
            Tag::macaddr8 => "macaddr8",
            Tag::money => "money",
            Tag::macaddr => "macaddr",
            Tag::inet => "inet",
            Tag::aclitem => "aclitem",
            Tag::bpchar => "bpchar",
            Tag::varchar => "varchar",
            Tag::date => "date",
            Tag::time => "time",
            Tag::timestamp => "timestamp",
            Tag::timestamptz => "timestamptz",
            Tag::interval => "interval",
            Tag::pg_database => "pg_database",
            Tag::timetz => "timetz",
            Tag::bit => "bit",
            Tag::varbit => "varbit",
            Tag::numeric => "numeric",
            Tag::uuid => "uuid",
            Tag::bool_array => "bool_array",
            Tag::bytea_array => "bytea_array",
            Tag::char_array => "char_array",
            Tag::name_array => "name_array",
            Tag::int8_array => "int8_array",
            Tag::int2_array => "int2_array",
            Tag::int2vector_array => "int2vector_array",
            Tag::int4_array => "int4_array",
            Tag::text_array => "text_array",
            Tag::oid_array => "oid_array",
            Tag::tid_array => "tid_array",
            Tag::xid_array => "xid_array",
            Tag::cid_array => "cid_array",
            Tag::json_array => "json_array",
            Tag::xml_array => "xml_array",
            Tag::point_array => "point_array",
            Tag::lseg_array => "lseg_array",
            Tag::path_array => "path_array",
            Tag::box_array => "box_array",
            Tag::polygon_array => "polygon_array",
            Tag::line_array => "line_array",
            Tag::cidr_array => "cidr_array",
            Tag::float4_array => "float4_array",
            Tag::float8_array => "float8_array",
            Tag::circle_array => "circle_array",
            Tag::macaddr8_array => "macaddr8_array",
            Tag::money_array => "money_array",
            Tag::macaddr_array => "macaddr_array",
            Tag::inet_array => "inet_array",
            Tag::aclitem_array => "aclitem_array",
            Tag::bpchar_array => "bpchar_array",
            Tag::varchar_array => "varchar_array",
            Tag::date_array => "date_array",
            Tag::time_array => "time_array",
            Tag::timestamp_array => "timestamp_array",
            Tag::timestamptz_array => "timestamptz_array",
            Tag::interval_array => "interval_array",
            Tag::pg_database_array => "pg_database_array",
            Tag::timetz_array => "timetz_array",
            Tag::bit_array => "bit_array",
            Tag::varbit_array => "varbit_array",
            Tag::numeric_array => "numeric_array",
            Tag::jsonb => "jsonb",
            Tag::jsonb_array => "jsonb_array",
            Tag::jsonpath => "jsonpath",
            Tag::jsonpath_array => "jsonpath_array",
            Tag::pg_database_array2 => "pg_database_array2",
            _ => return None,
        })
    }

    pub fn is_binary_format_supported(self) -> bool {
        match self {
            // TODO: .int2_array, .float8_array,
            Tag::bool
            | Tag::timestamp
            | Tag::timestamptz
            | Tag::time
            | Tag::int4_array
            | Tag::float4_array
            | Tag::int4
            | Tag::float8
            | Tag::float4
            | Tag::bytea
            | Tag::numeric => true,

            _ => false,
        }
    }

    pub fn format_code(self) -> Short {
        if self.is_binary_format_supported() {
            return 1;
        }

        0
    }

    // Zig: pub const toJSTypedArrayType / toJS / fromJS = @import("../../../sql_jsc/...").*;
    // Deleted per PORTING.md — these become extension-trait methods in `bun_sql_jsc`.

    // TODO(port): `byteArrayType` / `pgArrayType` returned a *type* at comptime based on a
    // comptime `Tag` value. Rust cannot return a type from a const fn. Callers should
    // instead name `PostgresBinarySingleDimensionArray<i32>` / `<f32>` directly, or this
    // can be modeled as a trait with an associated type if dispatch-by-Tag is needed.
    //
    // Original mapping:
    //   .int4_array   => i32
    //   .float4_array => f32
    //   else          => error.UnsupportedArrayType
}

// Zig: `fn PostgresBinarySingleDimensionArray(comptime T: type) type { return extern struct { ... } }`
#[repr(C)]
pub struct PostgresBinarySingleDimensionArray<T> {
    // struct array_int4 {
    //   int4_t ndim; /* Number of dimensions */
    //   int4_t _ign; /* offset for data, removed by libpq */
    //   Oid elemtype; /* type of element in the array */
    //
    //   /* First dimension */
    //   int4_t size; /* Number of elements */
    //   int4_t index; /* Index of first element */
    //   int4_t first_value; /* Beginning of integer data */
    // };
    pub ndim: i32,
    pub offset_for_data: i32,
    pub element_type: i32,

    pub len: i32,
    pub index: i32,
    pub first_value: T,
}

impl<T: Copy> PostgresBinarySingleDimensionArray<T> {
    pub fn slice(&mut self) -> &mut [T] {
        // `len` is server-controlled; callers must validate it against
        // the backing buffer length before calling this.
        if self.len <= 0 {
            return &mut [];
        }

        // SAFETY: `first_value` is the start of a contiguous trailing array of T-sized
        // (length-prefix, value) pairs in the wire buffer; caller has validated `len`
        // against the backing buffer.
        unsafe {
            let head: *mut T = &mut self.first_value as *mut T;
            let mut current: *mut T = head;
            let len: usize = usize::try_from(self.len).unwrap();
            for i in 0..len {
                // Skip every other value as it contains the size of the element
                current = current.add(1);

                let val: T = *current;
                // Zig: const Int = std.meta.Int(.unsigned, @bitSizeOf(T));
                //      const swapped = @byteSwap(@as(Int, @bitCast(val)));
                //      head[i] = @bitCast(swapped);
                // TODO(port): generic byte-swap over T. Only instantiated for i32/f32 in
                // practice (see byteArrayType). Phase B: add a `ByteSwap` trait or
                // monomorphize for i32/f32 explicitly.
                let swapped: T = byte_swap_same_size(val);
                *head.add(i) = swapped;

                current = current.add(1);
            }

            core::slice::from_raw_parts_mut(head, len)
        }
    }

    pub fn init(bytes: &[u8]) -> *mut Self {
        // SAFETY: caller guarantees `bytes` is at least `size_of::<Self>()` and suitably
        // aligned for `Self`. Zig used @ptrCast(@alignCast(@constCast(bytes.ptr))).
        unsafe {
            let this: *mut Self = bytes.as_ptr() as *mut u8 as *mut Self;
            (*this).ndim = i32::swap_bytes((*this).ndim);
            (*this).offset_for_data = i32::swap_bytes((*this).offset_for_data);
            (*this).element_type = i32::swap_bytes((*this).element_type);
            (*this).len = i32::swap_bytes((*this).len);
            (*this).index = i32::swap_bytes((*this).index);
            this
        }
    }
}

// Helper for `slice()`: bitcast → byte-swap → bitcast, matching Zig's
// `@bitCast(@byteSwap(@as(Int, @bitCast(val))))` for same-size POD.
// TODO(port): replace with a sealed trait implemented for i32/f32 (the only T used).
#[inline]
unsafe fn byte_swap_same_size<T: Copy>(val: T) -> T {
    // SAFETY: T is Copy and size_of::<T>() ∈ {2,4,8}; transmute_copy is a same-size
    // bitcast to/from the matching uN, mirroring Zig `@bitCast(@byteSwap(@bitCast(val)))`.
    match core::mem::size_of::<T>() {
        4 => {
            let bits: u32 = core::mem::transmute_copy(&val);
            let swapped = bits.swap_bytes();
            core::mem::transmute_copy(&swapped)
        }
        8 => {
            let bits: u64 = core::mem::transmute_copy(&val);
            let swapped = bits.swap_bytes();
            core::mem::transmute_copy(&swapped)
        }
        2 => {
            let bits: u16 = core::mem::transmute_copy(&val);
            let swapped = bits.swap_bytes();
            core::mem::transmute_copy(&swapped)
        }
        _ => unreachable!(),
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/types/Tag.zig (267 lines)
//   confidence: medium
//   todos:      3
//   notes:      Non-exhaustive enum(short) → transparent newtype + assoc consts; byteArrayType/pgArrayType (comptime type return) dropped — callers name PostgresBinarySingleDimensionArray<T> directly; generic byte-swap stubbed via transmute_copy.
// ──────────────────────────────────────────────────────────────────────────
