//! `Channel` against a stand-in for c-ares, under Miri.

use super::*;
use core::cell::RefCell;

thread_local! {
    static SOCKETS: Cell<(ares_sock_state_cb, *mut c_void)> = const { Cell::new((None, ptr::null_mut())) };
    static IN_FLIGHT: RefCell<Vec<(ares_callback, *mut c_void)>> = const { RefCell::new(Vec::new()) };
}

fn fail_all(err: Error) {
    for (callback, arg) in IN_FLIGHT.take() {
        // SAFETY: what `ares_query` was given, called once.
        unsafe { callback(arg, err as c_int, 0, ptr::null_mut(), 0) };
    }
}

type Alloc = Option<extern "C" fn()>;

#[unsafe(no_mangle)]
extern "C" fn ares_library_init_mem(_: c_int, _: Alloc, _: Alloc, _: Alloc) -> c_int {
    ARES_SUCCESS
}

#[unsafe(no_mangle)]
extern "C" fn ares_init_options(out: &mut *mut ares_channel_t, opts: &Options, _: c_int) -> c_int {
    SOCKETS.set((opts.sock_state_cb, opts.sock_state_cb_data));
    *out = ptr::dangling_mut();
    ARES_SUCCESS
}

#[unsafe(no_mangle)]
extern "C" fn ares_destroy(_: *mut ares_channel_t) {
    fail_all(Error::EDESTRUCTION);
    let (callback, data) = SOCKETS.get();
    // SAFETY: what `ares_init_options` was given.
    unsafe { callback.unwrap()(data, 7, 0, 0) };
}

/// A name that starts with `!` fails inside the call, after the queries in flight.
#[unsafe(no_mangle)]
extern "C" fn ares_query(
    _: &ares_channel_t,
    name: CStrRef<'_>,
    _: c_int,
    _: RecordType,
    callback: ares_callback,
    arg: *mut c_void,
) {
    IN_FLIGHT.with_borrow_mut(|queries| queries.push((callback, arg)));
    if name.to_cstr().to_bytes().starts_with(b"!") {
        fail_all(Error::ECONNREFUSED);
    }
}

#[unsafe(no_mangle)]
extern "C" fn ares_cancel(_: &ares_channel_t) {
    fail_all(Error::ECANCELLED);
}

#[unsafe(no_mangle)]
extern "C" fn ares_queue_active_queries(_: &ares_channel_t) -> usize {
    IN_FLIGHT.with_borrow(Vec::len)
}

struct NoSockets;
impl ChannelContainer for NoSockets {
    fn on_dns_socket_state(&self, _: ares_socket_t, _: bool, _: bool) {}
}

type Id = Box<u32>;

fn open(channel: &Channel<Id>) {
    // SAFETY: each test closes it before it moves.
    unsafe { channel.open(&NoSockets, ChannelOptions::default()) }.unwrap();
}

fn ask(channel: &Channel<Id>, name: &[u8], id: u32) -> Vec<(u32, Error)> {
    errors(channel.resolve(RecordType::A, name, Box::new(id)))
}

fn errors(answers: Answers<Id>) -> Vec<(u32, Error)> {
    let errors = answers.map(|(id, answer)| (*id, answer.err().unwrap()));
    errors.collect()
}

#[test]
fn answers_come_in_the_order_c_ares_gave_them() {
    let channel = Channel::default();
    open(&channel);
    assert_eq!(ask(&channel, b"a", 1), []);
    assert_eq!(ask(&channel, b"b", 2), []);
    assert!(channel.has_active_queries());
    let refused = [1, 2, 3].map(|id| (id, Error::ECONNREFUSED));
    assert_eq!(ask(&channel, b"!", 3), refused);
    assert!(!channel.has_active_queries());
    assert_eq!(errors(channel.close()), []);
}

#[test]
fn the_channel_can_be_used_and_closed_between_two_answers() {
    let channel = Channel::default();
    open(&channel);
    assert_eq!(ask(&channel, b"a", 1), []);
    assert_eq!(ask(&channel, b"b", 2), []);
    let mut outer = channel.cancel();
    assert_eq!(*outer.next().unwrap().0, 1);
    assert_eq!(ask(&channel, b"!", 3), [(3, Error::ECONNREFUSED)]);
    assert_eq!(ask(&channel, b"c", 4), []);
    assert_eq!(errors(channel.close()), [(4, Error::EDESTRUCTION)]);
    open(&channel);
    assert_eq!(errors(outer), [(2, Error::ECANCELLED)]);
    assert_eq!(errors(channel.close()), []);
}

#[test]
fn a_closed_channel_never_calls_c_ares() {
    let channel = Channel::default();
    assert_eq!(ask(&channel, b"a", 1), [(1, Error::EDESTRUCTION)]);
    assert_eq!(errors(channel.cancel()), []);
    assert_eq!(errors(channel.process_timeouts()), []);
    assert_eq!(errors(channel.close()), []);
    assert!(!channel.has_active_queries());
    assert_eq!(channel.servers().err(), Some(Error::EDESTRUCTION));
    let (result, answers) = channel.set_servers(None);
    assert_eq!(
        (result, errors(answers)),
        (Err(Error::EDESTRUCTION), vec![])
    );
}

#[test]
fn a_name_that_does_not_fit_or_has_a_nul_is_not_sent() {
    let channel = Channel::default();
    open(&channel);
    assert_eq!(ask(&channel, b"a\0b", 1), [(1, Error::EBADNAME)]);
    assert_eq!(ask(&channel, &[b'a'; 1023], 2), [(2, Error::EBADNAME)]);
    assert!(!channel.has_active_queries());
    assert_eq!(ask(&channel, &[b'a'; 1022], 3), []);
    assert_eq!(errors(channel.close()), [(3, Error::EDESTRUCTION)]);
}

#[test]
fn statuses() {
    assert_eq!(Error::check(0), Ok(()));
    assert_eq!(Error::check(1), Err(Error::ENOTFOUND));
    assert_eq!(Error::check(19), Err(Error::ENOTFOUND));
    assert_eq!(Error::check(26), Err(Error::ENOSERVER));
}

#[test]
fn dropping_an_idle_channel_reports_its_sockets_to_the_fields_after_it() {
    struct Owner<'a> {
        channel: Channel<Id>,
        closed: Box<&'a Cell<Option<ares_socket_t>>>,
    }
    impl ChannelContainer for Owner<'_> {
        fn on_dns_socket_state(&self, socket: ares_socket_t, _: bool, _: bool) {
            self.closed.set(Some(socket));
        }
    }
    let closed = Cell::new(None);
    let owner = Box::new(Owner {
        channel: Channel::default(),
        closed: Box::new(&closed),
    });
    // SAFETY: boxed, idle, and `closed` drops after `channel`.
    unsafe { owner.channel.open(&*owner, ChannelOptions::default()) }.unwrap();
    drop(owner);
    assert_eq!(closed.get(), Some(7));
}
