use super::int_types::{Int4, short as Short};

// Non-exhaustive: any `short` value is a valid `Tag`. A `#[repr(i16)] enum`
// cannot hold arbitrary values, so model as a transparent newtype with
// associated consts.
#[repr(transparent)]
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
pub struct Tag(pub Short);

/// Emits the `Tag::name` associated consts, `tag_name()` and `array_element()`
/// from a single `name = oid [array_name = array_oid]` list, so they cannot drift apart.
macro_rules! pg_tags {
    ( $( $name:ident = $oid:literal $( [ $array:ident = $array_oid:literal ] )* ),* $(,)? ) => {
        #[allow(non_upper_case_globals)]
        impl Tag {
            $(
                pub const $name: Tag = Tag($oid);
                $( pub const $array: Tag = Tag($array_oid); )*
            )*

            pub fn tag_name(self) -> Option<&'static str> {
                Some(match self {
                    $(
                        Tag::$name => stringify!($name).trim_start_matches("r#"),
                        $( Tag::$array => stringify!($array), )*
                    )*
                    _ => return None,
                })
            }

            pub fn array_element(self) -> Option<Tag> {
                Some(match self {
                    $( $( Tag::$array => Tag::$name, )* )*
                    _ => return None,
                })
            }
        }
    };
}

// select e.typname, e.oid, a.oid from pg_type a join pg_type e on e.oid = a.typelem
//   where a.typcategory = 'A' and e.typarray = a.oid and e.typtype <> 'c' and a.oid < 10000
//   order by e.oid;
pg_tags! {
    unspecified = 0,
    bool = 16 [bool_array = 1000],
    bytea = 17 [bytea_array = 1001],
    char = 18 [char_array = 1002],
    name = 19 [name_array = 1003],
    int8 = 20 [int8_array = 1016],
    int2 = 21 [int2_array = 1005],
    int2vector = 22 [int2vector_array = 1006],
    int4 = 23 [int4_array = 1007],
    regproc = 24 [regproc_array = 1008],
    text = 25 [text_array = 1009],
    oid = 26 [oid_array = 1028],
    tid = 27 [tid_array = 1010],
    xid = 28 [xid_array = 1011],
    cid = 29 [cid_array = 1012],
    oidvector = 30 [oidvector_array = 1013],
    json = 114 [json_array = 199],
    xml = 142 [xml_array = 143],
    point = 600 [point_array = 1017],
    lseg = 601 [lseg_array = 1018],
    path = 602 [path_array = 1019],
    r#box = 603 [box_array = 1020],
    polygon = 604 [polygon_array = 1027],
    line = 628 [line_array = 629],
    cidr = 650 [cidr_array = 651],
    float4 = 700 [float4_array = 1021],
    float8 = 701 [float8_array = 1022],
    circle = 718 [circle_array = 719],
    macaddr8 = 774 [macaddr8_array = 775],
    money = 790 [money_array = 791],
    macaddr = 829 [macaddr_array = 1040],
    inet = 869 [inet_array = 1041],
    aclitem = 1033 [aclitem_array = 1034],
    bpchar = 1042 [bpchar_array = 1014],
    varchar = 1043 [varchar_array = 1015],
    date = 1082 [date_array = 1182],
    time = 1083 [time_array = 1183],
    timestamp = 1114 [timestamp_array = 1115],
    timestamptz = 1184 [timestamptz_array = 1185],
    interval = 1186 [interval_array = 1187],
    // Its array OID is assigned at initdb and differs between server versions.
    pg_database = 1248 [pg_database_array = 12052] [pg_database_array2 = 10052],
    timetz = 1266 [timetz_array = 1270],
    bit = 1560 [bit_array = 1561],
    varbit = 1562 [varbit_array = 1563],
    numeric = 1700 [numeric_array = 1231],
    refcursor = 1790 [refcursor_array = 2201],
    regprocedure = 2202 [regprocedure_array = 2207],
    regoper = 2203 [regoper_array = 2208],
    regoperator = 2204 [regoperator_array = 2209],
    regclass = 2205 [regclass_array = 2210],
    regtype = 2206 [regtype_array = 2211],
    cstring = 2275 [cstring_array = 1263],
    uuid = 2950 [uuid_array = 2951],
    txid_snapshot = 2970 [txid_snapshot_array = 2949],
    pg_lsn = 3220 [pg_lsn_array = 3221],
    tsvector = 3614 [tsvector_array = 3643],
    tsquery = 3615 [tsquery_array = 3645],
    gtsvector = 3642 [gtsvector_array = 3644],
    regconfig = 3734 [regconfig_array = 3735],
    regdictionary = 3769 [regdictionary_array = 3770],
    jsonb = 3802 [jsonb_array = 3807],
    int4range = 3904 [int4range_array = 3905],
    numrange = 3906 [numrange_array = 3907],
    tsrange = 3908 [tsrange_array = 3909],
    tstzrange = 3910 [tstzrange_array = 3911],
    daterange = 3912 [daterange_array = 3913],
    int8range = 3926 [int8range_array = 3927],
    jsonpath = 4072 [jsonpath_array = 4073],
    regnamespace = 4089 [regnamespace_array = 4090],
    regrole = 4096 [regrole_array = 4097],
    regcollation = 4191 [regcollation_array = 4192],
    int4multirange = 4451 [int4multirange_array = 6150],
    nummultirange = 4532 [nummultirange_array = 6151],
    tsmultirange = 4533 [tsmultirange_array = 6152],
    tstzmultirange = 4534 [tstzmultirange_array = 6153],
    datemultirange = 4535 [datemultirange_array = 6155],
    int8multirange = 4536 [int8multirange_array = 6157],
    pg_snapshot = 5038 [pg_snapshot_array = 5039],
    xid8 = 5069 [xid8_array = 271],
}

impl Tag {
    /// An OID above `Short::MAX` is a user-defined type, which travels as text.
    pub fn from_oid(oid: Int4) -> Tag {
        Short::try_from(oid).map_or(Tag::text, Tag)
    }

    pub fn is_json(self) -> bool {
        matches!(self, Tag::json | Tag::jsonb)
    }

    /// `typdelim` of the elements of this array type.
    pub fn array_delimiter(self) -> u8 {
        if self == Tag::box_array { b';' } else { b',' }
    }

    /// Of a result column. Not read for parameters.
    pub fn is_binary_in(self, formats: ResultFormats) -> bool {
        match self {
            Tag::bool
            | Tag::int4
            | Tag::float4
            | Tag::float8
            | Tag::timestamp
            | Tag::timestamptz
            | Tag::bytea
            | Tag::int4_array
            | Tag::float4_array => formats != ResultFormats::Text,
            Tag::int2_array | Tag::float8_array => formats == ResultFormats::Decodable,
            Tag::numeric | Tag::time => formats == ResultFormats::Raw,
            _ => false,
        }
    }

    pub fn format_code(self, formats: ResultFormats) -> Short {
        Short::from(self.is_binary_in(formats))
    }
}

/// The result columns that a Bind asks for in binary.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ResultFormats {
    Text,
    /// Those that `DataCell` decodes from binary.
    Decodable,
    /// Those that `.raw()` has always handed out in binary: programs parse these bytes.
    Raw,
}
