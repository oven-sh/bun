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

use super::int_types::short as Short;

// Non-exhaustive: any `short` value is a valid `Tag`. A `#[repr(i16)] enum`
// cannot hold arbitrary values, so model as a transparent newtype with
// associated consts.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub struct Tag(pub Short);

/// Emits both the `Tag::name` associated consts and the `tag_name()` match
/// from a single `(name = oid)` list, so the two cannot drift apart.
macro_rules! pg_tags {
    ( $( $name:ident = $oid:literal ),* $(,)? ) => {
        #[allow(non_upper_case_globals)]
        impl Tag {
            $( pub const $name: Tag = Tag($oid); )*

            pub fn tag_name(self) -> Option<&'static str> {
                Some(match self {
                    $( Tag::$name => stringify!($name).trim_start_matches("r#"), )*
                    _ => return None,
                })
            }
        }
    };
}

pg_tags! {
    bool = 16,
    bytea = 17,
    char = 18,
    name = 19,
    int8 = 20,
    int2 = 21,
    int2vector = 22,
    int4 = 23,
    text = 25,
    oid = 26,
    xid = 28,
    cid = 29,
    json = 114,
    xml = 142,
    point = 600,
    lseg = 601,
    path = 602,
    r#box = 603,
    polygon = 604,
    line = 628,
    cidr = 650,
    float4 = 700,
    float8 = 701,
    circle = 718,
    macaddr8 = 774,
    money = 790,
    macaddr = 829,
    inet = 869,
    aclitem = 1033,
    bpchar = 1042,
    varchar = 1043,
    date = 1082,
    time = 1083,
    timestamp = 1114,
    timestamptz = 1184,
    interval = 1186,
    pg_database = 1248,
    timetz = 1266,
    bit = 1560,
    varbit = 1562,
    numeric = 1700,
    uuid = 2950,

    bool_array = 1000,
    bytea_array = 1001,
    char_array = 1002,
    name_array = 1003,
    int8_array = 1016,
    int2_array = 1005,
    int2vector_array = 1006,
    int4_array = 1007,
    text_array = 1009,
    oid_array = 1028,
    tid_array = 1010,
    xid_array = 1011,
    cid_array = 1012,
    json_array = 199,
    xml_array = 143,
    point_array = 1017,
    lseg_array = 1018,
    path_array = 1019,
    box_array = 1020,
    polygon_array = 1027,
    line_array = 629,
    cidr_array = 651,
    float4_array = 1021,
    float8_array = 1022,
    circle_array = 719,
    macaddr8_array = 775,
    money_array = 791,
    macaddr_array = 1040,
    inet_array = 1041,
    aclitem_array = 1034,
    bpchar_array = 1014,
    varchar_array = 1015,
    date_array = 1182,
    time_array = 1183,
    timestamp_array = 1115,
    timestamptz_array = 1185,
    interval_array = 1187,
    pg_database_array = 12052,
    timetz_array = 1270,
    bit_array = 1561,
    varbit_array = 1563,
    numeric_array = 1231,
    jsonb = 3802,
    jsonb_array = 3807,
    // Not really sure what this is.
    jsonpath = 4072,
    jsonpath_array = 4073,
    // another oid for pg_database
    pg_database_array2 = 10052,
}

impl Tag {
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

    // `toJS` / `fromJS` are extension-trait methods in `bun_sql_jsc`.
}
