/*
MIT License

Copyright (c) 2020 Oleg Fatkhiev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

/* Sources fetched from https://github.com/ofats/any_invocable on 2021-02-19. */

#ifndef _ANY_INVOKABLE_H_
#define _ANY_INVOKABLE_H_

#include <functional>
#include <memory>
#include <type_traits>

// clang-format off
/*
namespace std {
  template<class Sig> class any_invocable; // never defined

  template<class R, class... ArgTypes>
  class any_invocable<R(ArgTypes...) cv ref noexcept(noex)> {
  public:
    using result_type = R;

    // SECTION.3, construct/copy/destroy
    any_invocable() noexcept;
    any_invocable(nullptr_t) noexcept;
    any_invocable(any_invocable&&) noexcept;
    template<class F> any_invocable(F&&);

    template<class T, class... Args>
      explicit any_invocable(in_place_type_t<T>, Args&&...);
    template<class T, class U, class... Args>
      explicit any_invocable(in_place_type_t<T>, initializer_list<U>, Args&&...);

    any_invocable& operator=(any_invocable&&) noexcept;
    any_invocable& operator=(nullptr_t) noexcept;
    template<class F> any_invocable& operator=(F&&);
    template<class F> any_invocable& operator=(reference_wrapper<F>) noexcept;

    ~any_invocable();

    // SECTION.4, any_invocable modifiers
    void swap(any_invocable&) noexcept;

    // SECTION.5, any_invocable capacity
    explicit operator bool() const noexcept;

    // SECTION.6, any_invocable invocation
    R operator()(ArgTypes...) cv ref noexcept(noex);

    // SECTION.7, null pointer comparisons
    friend bool operator==(const any_invocable&, nullptr_t) noexcept;

    // SECTION.8, specialized algorithms
    friend void swap(any_invocable&, any_invocable&) noexcept;
  };
}
*/
// clang-format on

namespace ofats {

namespace any_detail {

template <std::size_t Len, std::size_t Align>
class my_aligned_storage_t {
private:
    alignas(Align) std::byte t_buff[Len];
};


using buffer = my_aligned_storage_t<sizeof(void*) * 2, alignof(void*)>;

template <class T>
inline constexpr bool is_small_object_v =
    sizeof(T) <= sizeof(buffer) && alignof(buffer) % alignof(T) == 0 &&
    std::is_nothrow_move_constructible_v<T>;

union storage {
  void* ptr_ = nullptr;
  buffer buf_;
};

enum class action { destroy, move };

template <class R, class... ArgTypes>
struct handler_traits {
  template <class Derived>
  struct handler_base {
    static void handle(action act, storage* current, storage* other = nullptr) {
      switch (act) {
        case (action::destroy):
          Derived::destroy(*current);
          break;
        case (action::move):
          Derived::move(*current, *other);
          break;
      }
    }
  };

  template <class T>
  struct small_handler : handler_base<small_handler<T>> {
    template <class... Args>
    static void create(storage& s, Args&&... args) {
      new (static_cast<void*>(&s.buf_)) T(std::forward<Args>(args)...);
    }

    static void destroy(storage& s) noexcept {
      T& value = *static_cast<T*>(static_cast<void*>(&s.buf_));
      value.~T();
    }

    static void move(storage& dst, storage& src) noexcept {
      create(dst, std::move(*static_cast<T*>(static_cast<void*>(&src.buf_))));
      destroy(src);
    }

    static R call(storage& s, ArgTypes... args) {
      return std::invoke(*static_cast<T*>(static_cast<void*>(&s.buf_)),
                         std::forward<ArgTypes>(args)...);
    }
  };

  template <class T>
  struct large_handler : handler_base<large_handler<T>> {
    template <class... Args>
    static void create(storage& s, Args&&... args) {
      s.ptr_ = new T(std::forward<Args>(args)...);
    }

    static void destroy(storage& s) noexcept { delete static_cast<T*>(s.ptr_); }

    static void move(storage& dst, storage& src) noexcept {
      dst.ptr_ = src.ptr_;
    }

    static R call(storage& s, ArgTypes... args) {
      return std::invoke(*static_cast<T*>(s.ptr_),
                         std::forward<ArgTypes>(args)...);
    }
  };

  template <class T>
  using handler = std::conditional_t<is_small_object_v<T>, small_handler<T>,
                                     large_handler<T>>;
};

template <class T>
struct is_in_place_type : std::false_type {};

template <class T>
struct is_in_place_type<std::in_place_type_t<T>> : std::true_type {};

template <class T>
inline constexpr auto is_in_place_type_v = is_in_place_type<T>::value;

template <class R, bool is_noexcept, class... ArgTypes>
class any_invocable_impl {
  template <class T>
  using handler =
      typename any_detail::handler_traits<R, ArgTypes...>::template handler<T>;

  using storage = any_detail::storage;
  using action = any_detail::action;
  using handle_func = void (*)(any_detail::action, any_detail::storage*,
                               any_detail::storage*);
  using call_func = R (*)(any_detail::storage&, ArgTypes...);

 public:
  using result_type = R;

  any_invocable_impl() noexcept = default;
  any_invocable_impl(std::nullptr_t) noexcept {}
  any_invocable_impl(any_invocable_impl&& rhs) noexcept {
    if (rhs.handle_) {
      handle_ = rhs.handle_;
      handle_(action::move, &storage_, &rhs.storage_);
      call_ = rhs.call_;
      rhs.handle_ = nullptr;
    }
  }

  any_invocable_impl& operator=(any_invocable_impl&& rhs) noexcept {
    any_invocable_impl{std::move(rhs)}.swap(*this);
    return *this;
  }
  any_invocable_impl& operator=(std::nullptr_t) noexcept {
    destroy();
    return *this;
  }

  ~any_invocable_impl() { destroy(); }

  void swap(any_invocable_impl& rhs) noexcept {
    if (handle_) {
      if (rhs.handle_) {
        storage tmp;
        handle_(action::move, &tmp, &storage_);
        rhs.handle_(action::move, &storage_, &rhs.storage_);
        handle_(action::move, &rhs.storage_, &tmp);
        std::swap(handle_, rhs.handle_);
        std::swap(call_, rhs.call_);
      } else {
        rhs.swap(*this);
      }
    } else if (rhs.handle_) {
      rhs.handle_(action::move, &storage_, &rhs.storage_);
      handle_ = rhs.handle_;
      call_ = rhs.call_;
      rhs.handle_ = nullptr;
    }
  }

  explicit operator bool() const noexcept { return handle_ != nullptr; }

 protected:
  template <class F, class... Args>
  void create(Args&&... args) {
    using hdl = handler<F>;
    hdl::create(storage_, std::forward<Args>(args)...);
    handle_ = &hdl::handle;
    call_ = &hdl::call;
  }

  void destroy() noexcept {
    if (handle_) {
      handle_(action::destroy, &storage_, nullptr);
      handle_ = nullptr;
    }
  }

  R call(ArgTypes... args) noexcept(is_noexcept) {
    return call_(storage_, std::forward<ArgTypes>(args)...);
  }

  friend bool operator==(const any_invocable_impl& f, std::nullptr_t) noexcept {
    return !f;
  }
  friend bool operator==(std::nullptr_t, const any_invocable_impl& f) noexcept {
    return !f;
  }
  friend bool operator!=(const any_invocable_impl& f, std::nullptr_t) noexcept {
    return static_cast<bool>(f);
  }
  friend bool operator!=(std::nullptr_t, const any_invocable_impl& f) noexcept {
    return static_cast<bool>(f);
  }

  friend void swap(any_invocable_impl& lhs, any_invocable_impl& rhs) noexcept {
    lhs.swap(rhs);
  }

 private:
  storage storage_;
  handle_func handle_ = nullptr;
  call_func call_;
};

template <class T>
using remove_cvref_t = std::remove_cv_t<std::remove_reference_t<T>>;

template <class AI, class F, bool noex, class R, class FCall, class... ArgTypes>
using can_convert = std::conjunction<
    std::negation<std::is_same<remove_cvref_t<F>, AI>>,
    std::negation<any_detail::is_in_place_type<remove_cvref_t<F>>>,
    std::is_invocable_r<R, FCall, ArgTypes...>,
    std::bool_constant<(!noex ||
                        std::is_nothrow_invocable_r_v<R, FCall, ArgTypes...>)>,
    std::is_constructible<std::decay_t<F>, F>>;

}  // namespace any_detail

template <class Signature>
class any_invocable;

#define __OFATS_ANY_INVOCABLE(cv, ref, noex, inv_quals)                        \
  template <class R, class... ArgTypes>                                        \
  class any_invocable<R(ArgTypes...) cv ref noexcept(noex)>                    \
      : public any_detail::any_invocable_impl<R, noex, ArgTypes...> {          \
    using base_type = any_detail::any_invocable_impl<R, noex, ArgTypes...>;    \
                                                                               \
   public:                                                                     \
    using base_type::base_type;                                                \
                                                                               \
    template <                                                                 \
        class F,                                                               \
        class = std::enable_if_t<any_detail::can_convert<                      \
            any_invocable, F, noex, R, F inv_quals, ArgTypes...>::value>>      \
    any_invocable(F&& f) {                                                     \
      base_type::template create<std::decay_t<F>>(std::forward<F>(f));         \
    }                                                                          \
                                                                               \
    template <class T, class... Args, class VT = std::decay_t<T>,              \
              class = std::enable_if_t<                                        \
                  std::is_move_constructible_v<VT> &&                          \
                  std::is_constructible_v<VT, Args...> &&                      \
                  std::is_invocable_r_v<R, VT inv_quals, ArgTypes...> &&       \
                  (!noex || std::is_nothrow_invocable_r_v<R, VT inv_quals,     \
                                                          ArgTypes...>)>>      \
    explicit any_invocable(std::in_place_type_t<T>, Args&&... args) {          \
      base_type::template create<VT>(std::forward<Args>(args)...);             \
    }                                                                          \
                                                                               \
    template <                                                                 \
        class T, class U, class... Args, class VT = std::decay_t<T>,           \
        class = std::enable_if_t<                                              \
            std::is_move_constructible_v<VT> &&                                \
            std::is_constructible_v<VT, std::initializer_list<U>&, Args...> && \
            std::is_invocable_r_v<R, VT inv_quals, ArgTypes...> &&             \
            (!noex ||                                                          \
             std::is_nothrow_invocable_r_v<R, VT inv_quals, ArgTypes...>)>>    \
    explicit any_invocable(std::in_place_type_t<T>,                            \
                           std::initializer_list<U> il, Args&&... args) {      \
      base_type::template create<VT>(il, std::forward<Args>(args)...);         \
    }                                                                          \
                                                                               \
    template <class F, class FDec = std::decay_t<F>>                           \
    std::enable_if_t<!std::is_same_v<FDec, any_invocable> &&                   \
                         std::is_move_constructible_v<FDec>,                   \
                     any_invocable&>                                           \
    operator=(F&& f) {                                                         \
      any_invocable{std::forward<F>(f)}.swap(*this);                           \
      return *this;                                                            \
    }                                                                          \
    template <class F>                                                         \
    any_invocable& operator=(std::reference_wrapper<F> f) {                    \
      any_invocable{f}.swap(*this);                                            \
      return *this;                                                            \
    }                                                                          \
                                                                               \
    R operator()(ArgTypes... args) cv ref noexcept(noex) {                     \
      return base_type::call(std::forward<ArgTypes>(args)...);                 \
    }                                                                          \
  };

// cv -> {`empty`, const}
// ref -> {`empty`, &, &&}
// noex -> {true, false}
// inv_quals -> (is_empty(ref) ? & : ref)
__OFATS_ANY_INVOCABLE(, , false, &)               // 000
__OFATS_ANY_INVOCABLE(, , true, &)                // 001
__OFATS_ANY_INVOCABLE(, &, false, &)              // 010
__OFATS_ANY_INVOCABLE(, &, true, &)               // 011
__OFATS_ANY_INVOCABLE(, &&, false, &&)            // 020
__OFATS_ANY_INVOCABLE(, &&, true, &&)             // 021
__OFATS_ANY_INVOCABLE(const, , false, const&)     // 100
__OFATS_ANY_INVOCABLE(const, , true, const&)      // 101
__OFATS_ANY_INVOCABLE(const, &, false, const&)    // 110
__OFATS_ANY_INVOCABLE(const, &, true, const&)     // 111
__OFATS_ANY_INVOCABLE(const, &&, false, const&&)  // 120
__OFATS_ANY_INVOCABLE(const, &&, true, const&&)   // 121

#undef __OFATS_ANY_INVOCABLE

}  // namespace ofats

/* We, uWebSockets define our own type */
namespace uWS {
  template <class T>
  using MoveOnlyFunction = ofats::any_invocable<T>;
}

#endif  // _ANY_INVOKABLE_H_
