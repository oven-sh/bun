use std::ffi::c_void;

use super::com::{
    Borrowed, Guid, Interface, RuntimeString, Status, TaskString, Unknown, Variant, interfaces,
};
use super::*;

pub const CLSID_APPLICATION_DESTINATIONS: Guid = Guid::new(0x86c14003_4d6b_4ef3_a7b4_0506663b2e68);
pub const CLSID_APPLICATION_DOCUMENT_LISTS: Guid =
    Guid::new(0x86bec222_30f2_47e0_9f25_60d11cd75c28);
pub const CLSID_DESTINATION_LIST: Guid = Guid::new(0x77f10cf0_3db5_4966_b520_b7c54fd35ed6);
pub const CLSID_DRAG_DROP_HELPER: Guid = Guid::new(0x4657278a_411b_11d2_839a_00c04fd918d0);
pub const CLSID_ENUMERABLE_OBJECT_COLLECTION: Guid =
    Guid::new(0x2d3468c1_36a7_43b6_ac24_d3f02fd9607a);
pub const CLSID_FILE_OPEN_DIALOG: Guid = Guid::new(0xdc1c5a9c_e88a_4dde_a5a1_60f82a20aef7);
pub const CLSID_FILE_OPERATION: Guid = Guid::new(0x3ad05575_8857_4850_9277_11b85bdb8e09);
pub const CLSID_FILE_SAVE_DIALOG: Guid = Guid::new(0xc0b4e2f3_ba21_4773_8dba_335ec946eb8b);
pub const CLSID_SHELL_LINK: Guid = Guid::new(0x00021401_0000_0000_c000_000000000046);
pub const CLSID_SPELL_CHECKER_FACTORY: Guid = Guid::new(0x7ab36653_1796_484b_bdfa_e74f1db7c1dc);
pub const CLSID_TASKBAR_LIST: Guid = Guid::new(0x56fdf344_fd6d_11d0_958a_006097c9a090);
pub const IID_I_DROP_SOURCE: Guid = Guid::new(0x00000121_0000_0000_c000_000000000046);
pub const IID_I_DROP_TARGET: Guid = Guid::new(0x00000122_0000_0000_c000_000000000046);
pub const IID_ID_WRITE_TEXT_ANALYSIS_SOURCE: Guid =
    Guid::new(0x688e1a58_5094_47c8_adc8_fbcea60ae92b);
pub const IID_I_AGILE_OBJECT: Guid = Guid::new(0x94ea2b94_e9cc_49e0_c0ff_ee64ca8f5b90);
pub const IID_I_EXPAND_COLLAPSE_PROVIDER: Guid = Guid::new(0xd847d3a5_cab0_4a98_8c32_ecb45c59ad24);
pub const IID_I_GRID_ITEM_PROVIDER: Guid = Guid::new(0xd02541f1_fb81_4d64_ae32_f520f8a6dbd1);
pub const IID_I_GRID_PROVIDER: Guid = Guid::new(0xb17d6187_0907_464b_a168_0ef17a1572b1);
pub const IID_I_INVOKE_PROVIDER: Guid = Guid::new(0x54fcb24b_e18e_47a2_b4d3_eccbe77599a2);
pub const IID_I_RANGE_VALUE_PROVIDER: Guid = Guid::new(0x36dc7aef_33e6_4691_afe1_2be7274b3d33);
pub const IID_I_RAW_ELEMENT_PROVIDER_FRAGMENT: Guid =
    Guid::new(0xf7063da8_8359_439c_9297_bbc5299a7d87);
pub const IID_I_RAW_ELEMENT_PROVIDER_FRAGMENT_ROOT: Guid =
    Guid::new(0x620ce2a5_ab8f_40a9_86cb_de3c75599b58);
pub const IID_I_RAW_ELEMENT_PROVIDER_SIMPLE: Guid =
    Guid::new(0xd6dd68d1_86fd_4332_8666_9abedea2d24c);
pub const IID_I_RAW_ELEMENT_PROVIDER_SIMPLE2: Guid =
    Guid::new(0xa0a839a9_8da1_4a82_806a_8e0d44e79f56);
pub const IID_I_SCROLL_ITEM_PROVIDER: Guid = Guid::new(0x2360c714_4bf1_4b26_ba65_9b21316127eb);
pub const IID_I_SELECTION_ITEM_PROVIDER: Guid = Guid::new(0x2acad808_b2d4_452d_a407_91ff1ad167b2);
pub const IID_I_SELECTION_PROVIDER: Guid = Guid::new(0xfb8b03af_3bdf_48d4_bd36_1a65793be168);
pub const IID_I_TABLE_ITEM_PROVIDER: Guid = Guid::new(0xb9734fa6_771f_4d78_9c90_2517999349cd);
pub const IID_I_TABLE_PROVIDER: Guid = Guid::new(0x9c860395_97b3_490a_b52a_858cc22af166);
pub const IID_I_TEXT_CHILD_PROVIDER: Guid = Guid::new(0x4c2de2b9_c88f_4f88_a111_f1d336b7d1a9);
pub const IID_I_TEXT_PROVIDER: Guid = Guid::new(0x3589c92c_63f3_4367_99bb_ada653b77cf2);
pub const IID_I_TEXT_PROVIDER2: Guid = Guid::new(0x0dc5e6ed_3e16_4bf1_8f9a_a979878bc195);
pub const IID_I_TEXT_RANGE_PROVIDER: Guid = Guid::new(0x5347ad7b_c355_46f8_aff5_909033582f63);
pub const IID_I_TEXT_RANGE_PROVIDER2: Guid = Guid::new(0x9bbce42c_1921_4f18_89ca_dba1910a0386);
pub const IID_I_TOGGLE_PROVIDER: Guid = Guid::new(0x56d00bd0_c4f4_433c_a836_1a52a57e0892);
pub const IID_I_VALUE_PROVIDER: Guid = Guid::new(0xc7935180_6fb3_4201_b174_7df73adbf64a);
pub const IID_I_WINDOW_PROVIDER: Guid = Guid::new(0x987df77b_db06_4d77_8f8a_86a9c3bb90b9);
pub const IID_TOAST_ACTIVATED_HANDLER: Guid = Guid::new(0xab54de2d_97d9_5528_b6ad_105afe156530);

/// Room for the result of a method, or what it reads.
#[repr(transparent)]
pub struct Raw<T>(*const T);

impl<T> Copy for Raw<T> {}

impl<T> Clone for Raw<T> {
    fn clone(&self) -> Raw<T> {
        *self
    }
}

impl<T> Raw<T> {
    /// # Safety
    /// It is valid for what the method does with it.
    pub unsafe fn new(address: *const T) -> Raw<T> {
        Raw(address)
    }
}

impl<T> Default for Raw<T> {
    fn default() -> Raw<T> {
        Raw(std::ptr::null())
    }
}

interfaces! {
    ID3D11Device = 0xdb6f6ddb_ac77_4e88_8253_819df9bbf140 {
        39 get_device_removed_reason() -> Status;
    }
    ID3D11DeviceContext = 0xc0bfa96c_e089_44fb_8eaf_26f8796190da {
        48 update_subresource(to: Borrowed, part: u32, area: &D3dBox, pixels: Raw<[u8; 4]>, bytes_per_row: u32, bytes_per_slice: u32);
    }
    ID3D11Texture2D = 0x6f15aaf2_d208_4e89_9ab4_489535d34f9c {}
    IDCompositionAnimation = 0xcbfd91d9_51b2_45e4_b3de_d19ccfb863c5 {
        4 set_absolute_begin_time(ticks: i64) -> Status;
        5 add_cubic(from: f64, constant: f32, linear: f32, quadratic: f32, cubic: f32) -> Status;
        7 add_repeat(from: f64, last: f64) -> Status;
        8 end(at: f64, value: f32) -> Status;
    }
    IDCompositionDesktopDevice = 0x5f4633fe_1e08_4cb8_8c75_ce24333f5602 {
        3 commit() -> Status;
        6 create_visual(visual: &mut Option<Unknown>) -> Status;
        8 create_surface(width: u32, height: u32, format: u32, alpha: u32, surface: &mut Option<IDCompositionSurface>) -> Status;
        9 create_virtual_surface(width: u32, height: u32, format: u32, alpha: u32, surface: &mut Option<IDCompositionVirtualSurface>) -> Status;
        14 create_matrix_transform(transform: &mut Option<IDCompositionMatrixTransform>) -> Status;
        22 create_rectangle_clip(clip: &mut Option<IDCompositionRectangleClip>) -> Status;
        23 create_animation(animation: &mut Option<IDCompositionAnimation>) -> Status;
        24 create_target_for_hwnd(window: Handle, is_topmost: Bool, target: &mut Option<IDCompositionTarget>) -> Status;
    }
    IDCompositionMatrixTransform = 0x16cdff07_c503_419c_83f2_0965c7af1fa6 {
        4 animate_matrix_element(row: i32, column: i32, animation: Borrowed) -> Status;
        5 set_matrix_element(row: i32, column: i32, value: f32) -> Status;
    }
    IDCompositionRectangleClip = 0x9842ad7d_d9cf_4908_aed7_48b51da5e7c2 {}
    IDCompositionSurface = 0xbb8a4953_2c99_4f5a_96f5_4819027fa3ac {
        3 begin_draw(area: &DeviceRect, id: &Guid, texture: &mut Option<Unknown>, offset: &mut DevicePoint) -> Status;
        4 end_draw() -> Status;
        7 scroll(what: &DeviceRect, within: &DeviceRect, right: i32, down: i32) -> Status;
    }
    IDCompositionTarget = 0xeacdd04c_117e_4e17_88f4_d1b12b0e3d89 {
        3 set_root(visual: Borrowed) -> Status;
    }
    IDCompositionVirtualSurface = 0xae471c51_5f53_4a24_8d3e_d0c39c30b3f0 {}
    IDCompositionVisual3 = 0x2775f462_b6c1_4015_b0be_b3e7d6a4976d {
        4 set_offset_x(x: f32) -> Status;
        6 set_offset_y(y: f32) -> Status;
        7 set_transform(transform: Borrowed) -> Status;
        11 set_bitmap_interpolation_mode(mode: i32) -> Status;
        12 set_border_mode(mode: i32) -> Status;
        13 set_clip(clip: Borrowed) -> Status;
        15 set_content(content: Borrowed) -> Status;
        16 add_visual(child: Borrowed, is_above: Bool, sibling: Borrowed) -> Status;
        18 remove_all_visuals() -> Status;
        20 set_opacity_mode(mode: i32) -> Status;
        29 animate_opacity(animation: Borrowed) -> Status;
        30 set_opacity(opacity: f32) -> Status;
    }
    IDXGIAdapter = 0x2411e7e1_12ac_4ccf_bd14_9798e8534dc0 {
        8 get_desc(description: &mut DxgiAdapterDesc) -> Status;
    }
    IDXGIDevice3 = 0x6007896c_3244_4afd_bf18_a6d3beda5023 {
        7 get_adapter(adapter: &mut Option<IDXGIAdapter>) -> Status;
        17 trim();
    }

    IDataObject = 0x0000010e_0000_0000_c000_000000000046 {
        3 get_data(format: &FormatEtc, medium: &mut StgMedium) -> Status;
    }
    IDragSourceHelper = 0xde5bf786_477a_11d2_839d_00c04fd918d0 {
        3 initialize_from_bitmap(image: &ShDragImage, data: Borrowed) -> Status;
    }
    IDropTargetHelper = 0x4657278b_411b_11d2_839a_00c04fd918d0 {
        3 drag_enter(window: Handle, data: Borrowed, at: &DevicePoint, effect: u32) -> Status;
        4 drag_leave() -> Status;
        5 drag_over(at: &DevicePoint, effect: u32) -> Status;
        6 drop(data: Borrowed, at: &DevicePoint, effect: u32) -> Status;
    }
    IEnumSpellingError = 0x803e3bd4_2828_4410_8290_418d1d73c762 {
        3 next(error: &mut Option<ISpellingError>) -> Status;
    }
    IEnumString = 0x00000101_0000_0000_c000_000000000046 {
        3 next(count: u32, text: &mut Option<TaskString>, fetched: &mut u32) -> Status;
    }
    IFileDialog = 0x42f85136_db7e_439c_85f1_e4075d135fc8 {
        3 show(owner: Handle) -> Status;
        4 set_file_types(count: u32, filters: Raw<ComDlgFilterSpec>) -> Status;
        9 set_options(options: u32) -> Status;
        10 get_options(options: &mut u32) -> Status;
        12 set_folder(folder: Borrowed) -> Status;
        15 set_file_name(name: Str) -> Status;
        17 set_title(title: Str) -> Status;
        18 set_ok_button_label(label: Str) -> Status;
        20 get_result(item: &mut Option<IShellItem>) -> Status;
        22 set_default_extension(extension: Str) -> Status;
    }
    IFileOpenDialog = 0xd57c7288_d4ad_4768_be02_9d969532d960 {
        27 get_results(items: &mut Option<IShellItemArray>) -> Status;
    }
    IFileOperation = 0x947aab5f_0a5c_4c13_b4d6_4bf7836fc9f8 {
        5 set_operation_flags(flags: u32) -> Status;
        18 delete_item(item: Borrowed, progress: Borrowed) -> Status;
        21 perform_operations() -> Status;
        22 get_any_operations_aborted(were_aborted: &mut Bool) -> Status;
    }
    IApplicationDestinations = 0x12337d35_94c6_48a0_bce7_6a9c69d4d600 {
        3 set_app_id(id: Str) -> Status;
        5 remove_all_destinations() -> Status;
    }
    IApplicationDocumentLists = 0x3c594f9f_9f30_47a1_979a_c9e83d3d0a06 {
        3 set_app_id(id: Str) -> Status;
        4 get_list(kind: u32, count: u32, id: &Guid, list: &mut Option<Unknown>) -> Status;
    }
    ICustomDestinationList = 0x6332debf_87b5_4670_90c0_5e57b408a49e {
        3 set_app_id(id: Str) -> Status;
        4 begin_list(room: &mut u32, id: &Guid, removed: &mut Option<Unknown>) -> Status;
        5 append_category(name: Str, items: Borrowed) -> Status;
        6 append_known_category(category: u32) -> Status;
        7 add_user_tasks(items: Borrowed) -> Status;
        8 commit_list() -> Status;
        10 delete_list(id: Str) -> Status;
        11 abort_list() -> Status;
    }
    IObjectArray = 0x92ca9dcd_5622_4bba_a805_5e9f541bd8c9 {
        3 get_count(count: &mut u32) -> Status;
        4 get_at(index: u32, id: &Guid, object: &mut Option<Unknown>) -> Status;
    }
    IObjectCollection = 0x5632b1a4_e38a_400a_928a_d4cd63230295 {
        5 add_object(object: Borrowed) -> Status;
    }
    IPersistFile = 0x0000010b_0000_0000_c000_000000000046 {
        5 load(path: Str, mode: u32) -> Status;
        6 save(path: Str, remembers: Bool) -> Status;
    }
    IPropertyStore = 0x886d8eeb_8cf2_4446_8d02_cdba1dbdcf99 {
        5 get_value(key: &PropertyKey, value: &mut Variant) -> Status;
        6 set_value(key: &PropertyKey, value: &Variant) -> Status;
        7 commit() -> Status;
    }
    IShellLinkW = 0x000214f9_0000_0000_c000_000000000046 {
        3 get_path(path: Raw<u16>, size: i32, data: usize, flags: u32) -> Status;
        6 get_description(text: Raw<u16>, size: i32) -> Status;
        7 set_description(text: Str) -> Status;
        8 get_working_directory(path: Raw<u16>, size: i32) -> Status;
        9 set_working_directory(path: Str) -> Status;
        10 get_arguments(text: Raw<u16>, size: i32) -> Status;
        11 set_arguments(text: Str) -> Status;
        16 get_icon_location(path: Raw<u16>, size: i32, index: &mut i32) -> Status;
        17 set_icon_location(path: Str, index: i32) -> Status;
        20 set_path(path: Str) -> Status;
    }
    IUIViewSettings = 0xc63657f6_8850_470d_88f8_455e16ea2c26 {
        6 get_user_interaction_mode(mode: &mut i32) -> Status;
    }
    IUIViewSettingsInterop = 0x3694dbf9_8f68_44be_8ff5_195c98ede8a6 {
        6 get_for_window(window: Handle, id: &Guid, settings: &mut Option<Unknown>) -> Status;
    }
    IShellItem = 0x43826d1e_e718_42ee_bc55_a1e261c37bfe {
        5 get_display_name(form: u32, name: &mut Option<TaskString>) -> Status;
    }
    IShellItemArray = 0xb63ea76d_1f85_456f_a19c_48159efa858b {
        7 get_count(count: &mut u32) -> Status;
        8 get_item_at(index: u32, item: &mut Option<IShellItem>) -> Status;
    }
    IShellItemImageFactory = 0xbcc18b79_ba16_442f_80c4_8a59c30c463b {
        3 get_image(size: DeviceSize, flags: i32, bitmap: &mut Handle) -> Status;
    }
    ISpellChecker = 0xb6fd0b71_e2bc_4653_8d05_f197e412770b {
        4 check(text: Str, errors: &mut Option<IEnumSpellingError>) -> Status;
        5 suggest(word: Str, words: &mut Option<IEnumString>) -> Status;
        6 add(word: Str) -> Status;
    }
    ISpellCheckerFactory = 0x8e018a9d_2415_4677_bf08_794ea61f94bb {
        5 create_spell_checker(language: Str, checker: &mut Option<ISpellChecker>) -> Status;
    }
    ISpellingError = 0xb7c82d61_fbe8_4b47_9b27_6c0d2e0de0a3 {
        3 get_start_index(index: &mut u32) -> Status;
        4 get_length(length: &mut u32) -> Status;
    }
    ITaskbarList3 = 0xea1afb91_9e28_4b86_90e9_9e9f8a5eefaf {
        3 hr_init() -> Status;
        4 add_tab(window: Handle) -> Status;
        5 delete_tab(window: Handle) -> Status;
        8 mark_fullscreen_window(window: Handle, is_fullscreen: Bool) -> Status;
        9 set_progress_value(window: Handle, done: u64, total: u64) -> Status;
        10 set_progress_state(window: Handle, state: i32) -> Status;
        15 thumb_bar_add_buttons(window: Handle, seven: u32, buttons: &[ThumbButton; 7]) -> Status;
        16 thumb_bar_update_buttons(window: Handle, seven: u32, buttons: &[ThumbButton; 7]) -> Status;
        18 set_overlay_icon(window: Handle, icon: Handle, description: Str) -> Status;
        19 set_thumbnail_tooltip(window: Handle, text: Str) -> Status;
        20 set_thumbnail_clip(window: Handle, area: Option<&DeviceRect>) -> Status;
    }

    IToastActivatedEventArgs = 0xe3bf92f3_c197_436f_8265_0625824f8dac {
        6 get_arguments(arguments: &mut RuntimeString) -> Status;
    }
    IToastNotification = 0x997e2675_059e_4e60_8b06_1760917c8b80 {
        11 add_activated(listener: Borrowed, token: &mut i64) -> Status;
    }
    IToastNotificationFactory = 0x04124b20_82c6_4229_b109_fd9ed4662b53 {
        6 create_toast_notification(content: Borrowed, toast: &mut Option<IToastNotification>) -> Status;
    }
    IToastNotificationManagerStatics = 0x50ac103f_d235_4598_bbef_98fe4d1a3ad4 {
        7 create_toast_notifier_with_id(id: Handle, notifier: &mut Option<IToastNotifier>) -> Status;
    }
    IToastNotifier = 0x75927b93_03f3_41ec_91d3_6e5bac1b38e7 {
        6 show(toast: Borrowed) -> Status;
        7 hide(toast: Borrowed) -> Status;
    }
    IXmlDocument = 0xf7f3a506_1e87_42d6_bcfb_b8c809fa5494 {}
    IXmlDocumentIO = 0x6cd0e74e_ee65_4489_9ebf_ca43e87ba637 {
        6 load_xml(xml: Handle) -> Status;
    }

    IDWriteFactory3 = 0x9a1b41c3_d3bb_466a_87fc_fe67556a3b65 {
        3 get_system_font_collection(collection: &mut Option<IDWriteFontCollection>, checks_for_updates: Bool) -> Status;
        26 get_system_font_fallback(fallback: &mut Option<IDWriteFontFallback>) -> Status;
        34 create_font_face_reference(path: Str, written: usize, index: u32, simulations: i32, face: &mut Option<IDWriteFontFaceReference>) -> Status;
        35 get_system_font_set(set: &mut Option<IDWriteFontSet>) -> Status;
    }
    IDWriteFactory6 = 0xf3744d80_21f7_42eb_b35d_995bc72fc223 {
        49 create_font_resource(file: Borrowed, index: u32, resource: &mut Option<IDWriteFontResource>) -> Status;
    }
    IDWriteFont3 = 0x29748ed6_8c9c_4a6a_be0b_d912e8538944 {
        3 get_font_family(family: &mut Option<IDWriteFontFamily>) -> Status;
        4 get_weight() -> i32;
        5 get_stretch() -> i32;
        6 get_style() -> i32;
        10 get_simulations() -> i32;
        21 get_font_face_reference(face: &mut Option<IDWriteFontFaceReference>) -> Status;
    }
    IDWriteFontCollection = 0xa84cee02_3eea_4eee_a827_87c1a02a0fcc {
        3 get_font_family_count() -> u32;
        4 get_font_family(index: u32, family: &mut Option<IDWriteFontFamily>) -> Status;
        5 find_family_name(name: Str, index: &mut u32, exists: &mut Bool) -> Status;
    }
    IDWriteFontFaceReference = 0x5e7fa7ca_dde3_424c_89f0_9fcd6fed58cd {
        3 create_font_face(face: &mut Option<Unknown>) -> Status;
        6 get_font_face_index() -> u32;
        8 get_font_file(file: &mut Option<IDWriteFontFile>) -> Status;
    }
    IDWriteFontFallback = 0xefa008f9_f7a1_48bf_b05c_f224713cc0ff {}
    IDWriteFontFamily = 0xda20d8ef_812a_4c43_9802_62ec4abd7add {
        4 get_font_count() -> u32;
        5 get_font(index: u32, font: &mut Option<Unknown>) -> Status;
        6 get_family_names(names: &mut Option<IDWriteLocalizedStrings>) -> Status;
    }
    IDWriteFontFile = 0x739d886a_cef5_47dc_8769_1a8b41bebbb0 {
        3 get_reference_key(key: &mut Raw<c_void>, size: &mut u32) -> Status;
        4 get_loader(loader: &mut Option<Unknown>) -> Status;
    }
    IDWriteFontResource = 0x1f803a76_6871_48e8_987f_b975551c50f2 {
        13 create_font_face(simulations: i32, values: Raw<DWriteFontAxisValue>, count: u32, face: &mut Option<Unknown>) -> Status;
    }
    IDWriteFontSet = 0x53585141_d9f8_4095_8321_d73cf6bd116b {
        4 get_font_face_reference(index: u32, face: &mut Option<IDWriteFontFaceReference>) -> Status;
        12 get_matching_fonts(property: &DWriteFontProperty, one: u32, set: &mut Option<IDWriteFontSet>) -> Status;
    }
    IDWriteGlyphRunAnalysis = 0x7d97dbf7_e085_42d4_81e3_6a883bded118 {
        3 get_alpha_texture_bounds(kind: i32, bounds: &mut DeviceRect) -> Status;
        4 create_alpha_texture(kind: i32, bounds: &DeviceRect, values: Raw<u8>, size: u32) -> Status;
    }
    IDWriteLocalFontFileLoader = 0xb2d9f3ec_c9fe_4a11_a2ec_d86208f7c0a2 {
        4 get_file_path_length_from_key(key: Raw<c_void>, size: u32, length: &mut u32) -> Status;
        5 get_file_path_from_key(key: Raw<c_void>, size: u32, path: Raw<u16>, length: u32) -> Status;
    }
    IDWriteLocalizedStrings = 0x08256209_099a_4b34_b86d_c22b110e7771 {
        4 find_locale_name(locale: Str, index: &mut u32, exists: &mut Bool) -> Status;
        7 get_string_length(index: u32, length: &mut u32) -> Status;
        8 get_string(index: u32, buffer: Raw<u16>, size: u32) -> Status;
    }
}

impl IDCompositionRectangleClip {
    /// The left, upper, right and lower edge.
    pub fn set(&self, edges: [f32; 4], radius: f32) -> super::com::Outcome {
        // SAFETY: each number has a method for an animation, and then one for a value.
        let set = |(index, value): (usize, f32)| {
            unsafe {
                self.method::<extern "system" fn(*mut c_void, f32) -> Status>(4 + index * 2)(
                    self.as_ptr(),
                    value,
                )
            }
            .ok()
        };
        edges
            .into_iter()
            .chain([radius; 8])
            .enumerate()
            .try_for_each(set)
    }
}

impl IDWriteFactory3 {
    /// `how` has the modes of rendering, measuring, fitting to the grid and smoothing.
    pub fn create_glyph_run_analysis(
        &self,
        run: &DWriteGlyphRun,
        matrix: &[f32; 6],
        how: [i32; 4],
        analysis: &mut Option<IDWriteGlyphRunAnalysis>,
    ) -> Status {
        type Method = extern "system" fn(
            *mut c_void,
            &DWriteGlyphRun,
            &[f32; 6],
            i32,
            i32,
            i32,
            i32,
            f32,
            f32,
            &mut Option<IDWriteGlyphRunAnalysis>,
        ) -> Status;
        // SAFETY: as the headers of the SDK have it.
        unsafe {
            self.method::<Method>(30)(
                self.as_ptr(),
                run,
                matrix,
                how[0],
                how[1],
                how[2],
                how[3],
                0.,
                0.,
                analysis,
            )
        }
    }
}

impl IDWriteFontFallback {
    /// For the regular face of no family in particular.
    pub fn map_characters(
        &self,
        source: Borrowed,
        length: u32,
        collection: Borrowed,
        font: &mut Option<Unknown>,
    ) -> Status {
        type Method = extern "system" fn(
            *mut c_void,
            Borrowed,
            u32,
            u32,
            Borrowed,
            Str,
            i32,
            i32,
            i32,
            &mut u32,
            &mut Option<Unknown>,
            &mut f32,
        ) -> Status;
        // SAFETY: as the headers of the SDK have it.
        unsafe {
            self.method::<Method>(3)(
                self.as_ptr(),
                source,
                0,
                length,
                collection,
                Str::NULL,
                400,
                0,
                5,
                &mut 0,
                font,
                &mut 0.,
            )
        }
    }
}
