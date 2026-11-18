use bun_engine_standalone as _;
use bun_icu::resource_bundle::ResourceBundle;
use bun_icu::{Error, host_language};

#[test]
fn typed_nodes() {
    let root = ResourceBundle::open_direct(c"zoneinfo64").unwrap();
    let (names, zones) = (
        root.by_key(c"Names").unwrap(),
        root.by_key(c"Zones").unwrap(),
    );
    drop(root);
    assert_eq!(names.item_count(), zones.item_count());

    let kabul: Vec<u16> = "Asia/Kabul".encode_utf16().collect();
    let index = (0..names.item_count())
        .find(|&index| names.string_at(index).unwrap() == kabul)
        .unwrap();
    assert_eq!(names.by_index(index).unwrap().string(), Ok(&kabul[..]));

    let zone = zones.by_index(index).unwrap();
    let offsets = zone.by_key(c"typeOffsets").unwrap();
    assert_eq!(offsets.int_vector().unwrap()[..2], [16608, 0]);
    assert_eq!(zone.by_key(c"typeMap").unwrap().binary().unwrap().len(), 2);
    assert!(zones.by_index(0).unwrap().int().unwrap() > 0);

    assert_eq!(offsets.int(), Err(Error::RESOURCE_TYPE_MISMATCH));
    assert_eq!(offsets.binary(), Err(Error::RESOURCE_TYPE_MISMATCH));
    assert_eq!(zones.string_at(0), Err(Error::RESOURCE_TYPE_MISMATCH));
    assert_eq!(zone.by_key(c"none").err(), Some(Error::MISSING_RESOURCE));
    for index in [names.item_count(), usize::MAX] {
        assert_eq!(names.string_at(index), Err(Error::MISSING_RESOURCE));
        assert_eq!(zones.by_index(index).err(), Some(Error::MISSING_RESOURCE));
    }
    assert!(ResourceBundle::open_direct(c"none").is_err());
}

#[test]
fn zone_names() {
    let names = ResourceBundle::open_zone_names(c"en").unwrap();
    let japan = names.by_key(c"zoneStrings").unwrap().by_key(c"meta:Japan");
    let standard = japan.unwrap().by_key(c"ls").unwrap();
    let standard = String::from_utf16(standard.string().unwrap()).unwrap();
    assert_eq!(standard, "Japan Standard Time");
}

#[test]
#[cfg(unix)]
fn a_process_starts_in_the_c_locale() {
    assert_eq!(host_language(), c"en-US");
}
