// Test program for the portable image, the C++ of adopt.c: two functions that the host calls on
// threads of its own. Neither has a check in its source. adopt.list names the first one, and the
// compiler writes the call of the check at its entry.
#if defined(__x86_64__)
#define WIN64 __attribute__((ms_abi))
#else
#define WIN64
#endif

extern "C" {
typedef WIN64 long long Callback(void *context, long long thread, long long call);
long long adopt_work(void *context, long long thread, long long call);
Callback *adopt_cpp_callback(int listed);
}

namespace bun_test {

struct Callbacks {
  WIN64 static long long listed(void *context, long long thread, long long call) { return adopt_work(context, thread, call); }
  WIN64 static long long unlisted(void *context, long long thread, long long call) { return adopt_work(context, thread, call); }
};

}  // namespace bun_test

Callback *adopt_cpp_callback(int listed) {
  return listed ? bun_test::Callbacks::listed : bun_test::Callbacks::unlisted;
}
