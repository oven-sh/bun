#pragma once

#define WTF_MAKE_NONCOPYABLE(Class) \
    Class(const Class&) = delete;   \
    Class& operator=(const Class&) = delete;

#define WTF_MAKE_NONMOVABLE(Class) \
    Class(Class&&) = delete;       \
    Class& operator=(Class&&) = delete;
