use std::ffi::c_void;

use super::com::Guid;
use super::{Bool, Handle, Str};

macro_rules! structures {
    ($($(#[$attribute:meta])* $name:ident $(<$life:lifetime>)? { $($field:ident: $type:ty),* $(,)? })*) => {$(
        #[repr(C)]
        $(#[$attribute])*
        #[derive(Clone, Copy)]
        pub struct $name $(<$life>)? { $(pub $field: $type),* }

        impl $(<$life>)? Default for $name $(<$life>)? {
            fn default() -> Self {
                // SAFETY: numbers, and addresses that may be null.
                unsafe { std::mem::zeroed() }
            }
        }
    )*};
}

pub type WndProc = unsafe extern "system" fn(Handle, u32, usize, isize) -> isize;
pub type TaskDialogCallback = unsafe extern "system" fn(Handle, u32, usize, isize, isize) -> i32;

structures! {
    DevicePoint { x: i32, y: i32 }
    DeviceSize { cx: i32, cy: i32 }
    #[derive(PartialEq)]
    DeviceRect { left: i32, top: i32, right: i32, bottom: i32 }
    Msg { hwnd: Handle, message: u32, w_param: usize, l_param: isize, time: u32, pt: DevicePoint }
    WndClassExW<'a> {
        cb_size: u32, style: u32, lpfn_wnd_proc: Option<WndProc>, cb_cls_extra: i32, cb_wnd_extra: i32, h_instance: Handle, h_icon: Handle,
        h_cursor: Handle, hbr_background: Handle, lpsz_menu_name: Str<'a>, lpsz_class_name: Str<'a>, h_icon_sm: Handle,
    }
    WindowPlacement { length: u32, flags: u32, show_cmd: u32, pt_min_position: DevicePoint, pt_max_position: DevicePoint, rc_normal_position: DeviceRect }
    WindowPos { hwnd: Handle, hwnd_insert_after: Handle, x: i32, y: i32, cx: i32, cy: i32, flags: u32 }
    MinMaxInfo { pt_reserved: DevicePoint, pt_max_size: DevicePoint, pt_max_position: DevicePoint, pt_min_track_size: DevicePoint, pt_max_track_size: DevicePoint }
    PaintStruct { hdc: Handle, f_erase: Bool, rc_paint: DeviceRect, f_restore: Bool, f_inc_update: Bool, rgb_reserved: [u8; 32] }
    PointerInfo {
        pointer_type: u32, pointer_id: u32, frame_id: u32, pointer_flags: u32, source_device: Handle, hwnd_target: Handle,
        pt_pixel_location: DevicePoint, pt_himetric_location: DevicePoint, pt_pixel_location_raw: DevicePoint, pt_himetric_location_raw: DevicePoint,
        dw_time: u32, history_count: u32, input_data: i32, dw_key_states: u32, performance_count: u64, button_change_type: u32,
    }
    PointerTouchInfo { pointer_info: PointerInfo, touch_flags: u32, touch_mask: u32, rc_contact: DeviceRect, rc_contact_raw: DeviceRect, orientation: u32, pressure: u32 }
    PointerPenInfo { pointer_info: PointerInfo, pen_flags: u32, pen_mask: u32, pressure: u32, rotation: u32, tilt_x: i32, tilt_y: i32 }
    InputMessageSource { device_type: u32, origin_id: u32 }
    ThumbButton { dw_mask: u32, i_id: u32, i_bitmap: u32, h_icon: Handle, sz_tip: [u16; 260], dw_flags: u32 }
    DisplayConfigPathInfo { source_adapter: [u32; 2], source: u32, _source: [u32; 2], target_adapter: [u32; 2], target: u32, _target: [u32; 10] }
    DisplayConfigDeviceInfoHeader { r#type: u32, size: u32, adapter_id: [u32; 2], id: u32 }
    DisplayConfigSourceDeviceName { header: DisplayConfigDeviceInfoHeader, view_gdi_device_name: [u16; 32] }
    DisplayConfigTargetDeviceName {
        header: DisplayConfigDeviceInfoHeader, flags: u32, output_technology: u32, _codes: [u16; 2], connector_instance: u32,
        monitor_friendly_device_name: [u16; 64], monitor_device_path: [u16; 128],
    }
    MouseTracking { cb_size: u32, dw_flags: u32, hwnd_track: Handle, dw_hover_time: u32 }
    FlashWInfo { cb_size: u32, hwnd: Handle, dw_flags: u32, u_count: u32, dw_timeout: u32 }
    MonitorInfoExW { cb_size: u32, rc_monitor: DeviceRect, rc_work: DeviceRect, dw_flags: u32, sz_device: [u16; 32] }
    DevModeW {
        dm_device_name: [u16; 32], dm_spec_version: u16, dm_driver_version: u16, dm_size: u16, dm_driver_extra: u16, dm_fields: u32,
        _position: [u32; 2], dm_display_orientation: u32, _fixed_output: u32, _printing: [u16; 5], dm_form_name: [u16; 32], dm_log_pixels: u16, dm_bits_per_pel: u32, dm_pels_width: u32,
        dm_pels_height: u32, dm_display_flags: u32, dm_display_frequency: u32, _rest: [u32; 8],
    }
    BitmapInfoHeader {
        bi_size: u32, bi_width: i32, bi_height: i32, bi_planes: u16, bi_bit_count: u16, bi_compression: u32, bi_size_image: u32,
        bi_x_pels_per_meter: i32, bi_y_pels_per_meter: i32, bi_clr_used: u32, bi_clr_important: u32,
    }
    IconInfo { f_icon: Bool, x_hotspot: u32, y_hotspot: u32, hbm_mask: Handle, hbm_color: Handle }
    LogFontW {
        lf_height: i32, lf_width: i32, lf_escapement: i32, lf_orientation: i32, lf_weight: i32, lf_italic: u8, lf_underline: u8, lf_strike_out: u8,
        lf_char_set: u8, lf_out_precision: u8, lf_clip_precision: u8, lf_quality: u8, lf_pitch_and_family: u8, lf_face_name: [u16; 32],
    }
    NonClientMetricsW {
        cb_size: u32, i_border_width: i32, i_scroll_width: i32, i_scroll_height: i32, i_caption_width: i32, i_caption_height: i32,
        lf_caption_font: LogFontW, i_sm_caption_width: i32, i_sm_caption_height: i32, lf_sm_caption_font: LogFontW, i_menu_width: i32, i_menu_height: i32,
        lf_menu_font: LogFontW, lf_status_font: LogFontW, lf_message_font: LogFontW, i_padded_border_width: i32,
    }
    HighContrastW { cb_size: u32, dw_flags: u32, lpsz_default_scheme: *mut u16 }
    LastInputInfo { cb_size: u32, dw_time: u32 }
    SystemPowerStatus {
        ac_line_status: u8, battery_flag: u8, battery_life_percent: u8, reserved1: u8, battery_life_time: u32, battery_full_life_time: u32,
    }
    ReasonContext<'a> { version: u32, flags: u32, reason: Str<'a>, _rest: [usize; 2] }
    OverlappedEntry { lp_completion_key: usize, lp_overlapped: *mut c_void, internal: usize, dw_number_of_bytes_transferred: u32 }
    ActCtxW<'a> {
        cb_size: u32, dw_flags: u32, lp_source: Str<'a>, w_processor_architecture: u16, w_lang_id: u16, lp_assembly_directory: Str<'a>,
        lp_resource_name: Str<'a>, lp_application_name: Str<'a>, h_module: Handle,
    }
    Margins { cx_left_width: i32, cx_right_width: i32, cy_top_height: i32, cy_bottom_height: i32 }
    #[repr(packed)]
    DwmBlurBehind { dw_flags: u32, f_enable: Bool, h_rgn_blur: Handle, f_transition_on_maximized: Bool }
    AppBarData { cb_size: u32, h_wnd: Handle, u_callback_message: u32, u_edge: u32, rc: DeviceRect, l_param: isize }

    D3dBox { left: u32, top: u32, front: u32, right: u32, bottom: u32, back: u32 }
    DxgiAdapterDesc {
        description: [u16; 128], vendor_id: u32, device_id: u32, sub_sys_id: u32, revision: u32, dedicated_video_memory: usize,
        dedicated_system_memory: usize, shared_system_memory: usize, adapter_luid: [u32; 2],
    }
    DWriteFontAxisValue { axis_tag: u32, value: f32 }
    DWriteGlyphRun<'a> {
        font_face: *mut c_void, font_em_size: f32, glyph_count: u32, glyph_indices: Option<&'a u16>, glyph_advances: Option<&'a f32>,
        glyph_offsets: usize, is_sideways: Bool, bidi_level: u32,
    }
    DWriteFontProperty<'a> { property_id: i32, property_value: Str<'a>, locale_name: Str<'a> }

    CandidateForm { dw_index: u32, dw_style: u32, pt_current_pos: DevicePoint, rc_area: DeviceRect }
    CompositionForm { dw_style: u32, pt_current_pos: DevicePoint, rc_area: DeviceRect }
    ReconvertString {
        dw_size: u32, dw_version: u32, dw_str_len: u32, dw_str_offset: u32, dw_comp_str_len: u32, dw_comp_str_offset: u32, dw_target_str_len: u32,
        dw_target_str_offset: u32,
    }
    ImeCharPosition { dw_size: u32, dw_char_pos: u32, pt: DevicePoint, c_line_height: u32, rc_document: DeviceRect }
    KeybdInput { w_vk: u16, w_scan: u16, dw_flags: u32, time: u32, dw_extra_info: usize }
    SentInput { r#type: u32, ki: KeybdInput, _rest: usize }

    UiaPoint { x: f64, y: f64 }
    UiaRect { left: f64, top: f64, width: f64, height: f64 }

    FormatEtc { cf_format: u16, ptd: *mut c_void, dw_aspect: u32, lindex: i32, tymed: u32 }
    StgMedium { tymed: u32, h_global: Handle, p_unk_for_release: *mut c_void }
    ShDragImage { size_drag_image: DeviceSize, pt_offset: DevicePoint, hbmp_drag_image: Handle, cr_color_key: u32 }
    ComDlgFilterSpec<'a> { psz_name: Str<'a>, psz_spec: Str<'a> }
    ShellExecuteInfoW<'a> {
        cb_size: u32, f_mask: u32, hwnd: Handle, lp_verb: Str<'a>, lp_file: Str<'a>, lp_parameters: Str<'a>, lp_directory: Str<'a>, n_show: i32,
        h_inst_app: Handle, lp_id_list: *mut c_void, lp_class: Str<'a>, hkey_class: Handle, dw_hot_key: u32, h_icon: Handle, h_process: Handle,
    }
    NotifyIconDataW {
        cb_size: u32, h_wnd: Handle, u_id: u32, u_flags: u32, u_callback_message: u32, h_icon: Handle, sz_tip: [u16; 128], dw_state: u32,
        dw_state_mask: u32, sz_info: [u16; 256], u_version: u32, sz_info_title: [u16; 64], dw_info_flags: u32, guid_item: Guid, h_balloon_icon: Handle,
    }
    NotifyIconIdentifier { cb_size: u32, h_wnd: Handle, u_id: u32, guid_item: Guid }
    MenuItemInfoW<'a> {
        cb_size: u32, f_mask: u32, f_type: u32, f_state: u32, w_id: u32, h_sub_menu: Handle, hbmp_checked: Handle, hbmp_unchecked: Handle,
        dw_item_data: usize, dw_type_data: Str<'a>, cch: u32, hbmp_item: Handle,
    }
    #[repr(packed)]
    TaskDialogButton<'a> { n_button_id: i32, psz_button_text: Str<'a> }
    #[repr(packed)]
    TaskDialogConfig<'a> {
        cb_size: u32, hwnd_parent: Handle, h_instance: Handle, dw_flags: u32, dw_common_buttons: u32, psz_window_title: Str<'a>,
        psz_main_icon: Str<'a>, psz_main_instruction: Str<'a>, psz_content: Str<'a>, c_buttons: u32, p_buttons: *const TaskDialogButton<'a>,
        n_default_button: i32, c_radio_buttons: u32, p_radio_buttons: *const c_void, n_default_radio_button: i32, psz_verification_text: Str<'a>,
        psz_expanded_information: Str<'a>, psz_expanded_control_text: Str<'a>, psz_collapsed_control_text: Str<'a>, psz_footer_icon: Str<'a>,
        psz_footer: Str<'a>, pf_callback: Option<TaskDialogCallback>, lp_callback_data: isize, cx_width: u32,
    }
}

impl PartialEq for DevicePoint {
    fn eq(&self, other: &DevicePoint) -> bool {
        (self.x, self.y) == (other.x, other.y)
    }
}

impl BitmapInfoHeader {
    /// With four bytes for a pixel. The rows go down if the height is negative.
    pub fn of(width: i32, height: i32) -> BitmapInfoHeader {
        BitmapInfoHeader {
            bi_size: size_of::<BitmapInfoHeader>() as u32,
            bi_width: width,
            bi_height: height,
            bi_planes: 1,
            bi_bit_count: 32,
            ..Default::default()
        }
    }
}

impl FormatEtc {
    pub fn global(format: u16) -> FormatEtc {
        FormatEtc {
            cf_format: format,
            dw_aspect: super::DVASPECT_CONTENT,
            lindex: -1,
            tymed: super::TYMED_HGLOBAL,
            ..Default::default()
        }
    }
}

impl DeviceRect {
    pub fn width(&self) -> i32 {
        self.right - self.left
    }

    pub fn height(&self) -> i32 {
        self.bottom - self.top
    }
}

#[repr(C)]
pub struct PropertyKey(pub Guid, pub u32);
